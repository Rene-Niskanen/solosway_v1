"""
Browser Automation Client - Python interface to the dev-browser Playwright server.

This client communicates with the Node.js dev-browser server to control a real
Chromium browser for visual automation tasks like:
- Navigating to websites
- Clicking elements
- Filling forms
- Taking screenshots
- Extracting data

The server maintains persistent browser state across script executions.
"""

import os
import asyncio
import aiohttp
import subprocess
import signal
import logging
import json
from typing import Dict, Any, List, Optional, AsyncGenerator, Callable, TYPE_CHECKING
from dataclasses import dataclass, field
from pathlib import Path

# Playwright import (runtime dependency - installed via requirements.txt)
try:
    from playwright.async_api import async_playwright  # type: ignore[import-untyped]
except ImportError:
    async_playwright = None  # type: ignore[assignment]

logger = logging.getLogger(__name__)


# Default ports (matching Openwork's dev-browser to avoid conflicts)
DEFAULT_HTTP_PORT = 9224
DEFAULT_CDP_PORT = 9225

# Electron app remote debugging port
ELECTRON_DEBUG_PORT = 9226


@dataclass
class PageInfo:
    """Information about a browser page"""
    name: str
    url: str = ""
    title: str = ""


@dataclass
class AISnapshot:
    """AI-friendly snapshot of page elements"""
    yaml: str
    refs: Dict[str, str] = field(default_factory=dict)


@dataclass
class BrowserResult:
    """Result from a browser action"""
    success: bool
    message: str
    data: Dict[str, Any] = field(default_factory=dict)
    screenshot_path: Optional[str] = None
    snapshot: Optional[str] = None


class BrowserServer:
    """
    Manages the dev-browser Node.js server process.
    """
    
    def __init__(self, port: int = DEFAULT_HTTP_PORT, headless: bool = False):
        self.port = port
        self.headless = headless
        self.process: Optional[subprocess.Popen] = None
        self.browser_dir = Path(__file__).parent.parent / "browser"
    
    async def start(self) -> bool:
        """Start the browser server if not already running"""
        if self.process and self.process.poll() is None:
            logger.info("🌐 Browser server already running")
            return True
        
        if not self.browser_dir.exists():
            logger.error(f"❌ Browser directory not found: {self.browser_dir}")
            return False
        
        try:
            # Build the command
            cmd = ["npm", "run", "start-server"]
            if self.headless:
                cmd.append("--")
                cmd.append("--headless")
            
            logger.info(f"🚀 Starting browser server on port {self.port}...")
            
            self.process = subprocess.Popen(
                cmd,
                cwd=str(self.browser_dir),
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                preexec_fn=os.setsid  # Create new process group for clean shutdown
            )
            
            # Wait for server to be ready (look for "Ready" message)
            ready = False
            for _ in range(60):  # 30 seconds timeout
                if self.process.stdout:
                    # Non-blocking read
                    import select
                    if select.select([self.process.stdout], [], [], 0.5)[0]:
                        line = self.process.stdout.readline()
                        if line:
                            logger.debug(f"🌐 Browser: {line.strip()}")
                            if "running on port" in line.lower() or "ready" in line.lower():
                                ready = True
                                break
                
                # Check if process died
                if self.process.poll() is not None:
                    logger.error("❌ Browser server process died")
                    return False
                
                await asyncio.sleep(0.5)
            
            if ready:
                logger.info(f"✅ Browser server ready on port {self.port}")
                return True
            else:
                logger.warning("⚠️ Browser server started but 'Ready' not detected")
                return True  # Might still work
                
        except Exception as e:
            logger.error(f"❌ Failed to start browser server: {e}", exc_info=True)
            return False
    
    async def stop(self):
        """Stop the browser server"""
        if self.process:
            try:
                # Kill the entire process group
                os.killpg(os.getpgid(self.process.pid), signal.SIGTERM)
                self.process.wait(timeout=5)
                logger.info("🛑 Browser server stopped")
            except Exception as e:
                logger.warning(f"⚠️ Error stopping browser server: {e}")
                try:
                    self.process.kill()
                except:
                    pass
            finally:
                self.process = None
    
    @property
    def is_running(self) -> bool:
        return self.process is not None and self.process.poll() is None


class BrowserClient:
    """
    Python client for controlling the dev-browser server.
    """
    
    def __init__(self, server_url: str = f"http://localhost:{DEFAULT_HTTP_PORT}"):
        self.server_url = server_url
        self._session: Optional[aiohttp.ClientSession] = None
    
    async def _get_session(self) -> aiohttp.ClientSession:
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession()
        return self._session
    
    async def close(self):
        """Close the HTTP session"""
        if self._session and not self._session.closed:
            await self._session.close()
    
    async def health_check(self) -> bool:
        """Check if the browser server is running"""
        # Use a fresh session each time to avoid event loop issues in Flask
        try:
            logger.debug(f"🌐 Health check: connecting to {self.server_url}/")
            async with aiohttp.ClientSession() as session:
                async with session.get(f"{self.server_url}/", timeout=aiohttp.ClientTimeout(total=5)) as resp:
                    logger.debug(f"🌐 Health check: status={resp.status}")
                    if resp.status == 200:
                        data = await resp.json()
                        has_endpoint = "wsEndpoint" in data
                        logger.info(f"✅ Browser health check passed: wsEndpoint={has_endpoint}")
                        return has_endpoint
                    else:
                        logger.warning(f"⚠️ Browser health check failed: status={resp.status}")
        except asyncio.TimeoutError:
            logger.warning("⚠️ Browser health check timed out")
        except Exception as e:
            logger.warning(f"⚠️ Browser health check error: {type(e).__name__}: {e}")
        return False
    
    async def list_pages(self) -> List[str]:
        """List all open page names"""
        try:
            session = await self._get_session()
            async with session.get(f"{self.server_url}/pages") as resp:
                if resp.status == 200:
                    data = await resp.json()
                    return data.get("pages", [])
        except Exception as e:
            logger.error(f"Failed to list pages: {e}")
        return []
    
    async def get_or_create_page(
        self, 
        name: str,
        viewport_width: int = 1280,
        viewport_height: int = 720
    ) -> Dict[str, Any]:
        """Get or create a named page"""
        try:
            session = await self._get_session()
            payload = {
                "name": name,
                "viewport": {"width": viewport_width, "height": viewport_height}
            }
            async with session.post(
                f"{self.server_url}/pages",
                json=payload
            ) as resp:
                if resp.status == 200:
                    return await resp.json()
                else:
                    error = await resp.text()
                    logger.error(f"Failed to get/create page: {error}")
        except Exception as e:
            logger.error(f"Failed to get/create page: {e}")
        return {}
    
    async def close_page(self, name: str) -> bool:
        """Close a page by name"""
        try:
            session = await self._get_session()
            async with session.delete(
                f"{self.server_url}/pages/{name}"
            ) as resp:
                return resp.status == 200
        except Exception as e:
            logger.error(f"Failed to close page: {e}")
        return False
    
    async def execute_script(self, script: str) -> Dict[str, Any]:
        """
        Execute a TypeScript/JavaScript script on the browser.
        
        The script runs in the context of the dev-browser client and has access to:
        - connect() - connect to the browser
        - client.page(name) - get/create a page
        - page.goto(url), page.click(), page.fill(), etc.
        
        Returns the script's output.
        """
        try:
            # Create a temp script file
            import tempfile
            tmp_dir = Path(__file__).parent.parent / "browser" / "tmp"
            tmp_dir.mkdir(parents=True, exist_ok=True)
            
            with tempfile.NamedTemporaryFile(
                mode='w', 
                suffix='.ts', 
                delete=False,
                dir=str(tmp_dir)
            ) as f:
                f.write(script)
                script_path = f.name
            
            # Execute with tsx using async subprocess
            browser_dir = Path(__file__).parent.parent / "browser"
            logger.info(f"🌐 Executing browser script in {browser_dir}")
            
            process = await asyncio.create_subprocess_exec(
                "npx", "tsx", script_path,
                cwd=str(browser_dir),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            
            try:
                stdout, stderr = await asyncio.wait_for(
                    process.communicate(),
                    timeout=120  # 2 minute timeout
                )
            except asyncio.TimeoutError:
                process.kill()
                await process.wait()
                return {
                    "success": False,
                    "stdout": "",
                    "stderr": "Script execution timed out after 2 minutes",
                    "returncode": -1
                }
            
            # Clean up
            try:
                os.unlink(script_path)
            except:
                pass
            
            return {
                "success": process.returncode == 0,
                "stdout": stdout.decode() if stdout else "",
                "stderr": stderr.decode() if stderr else "",
                "returncode": process.returncode
            }
            
        except Exception as e:
            logger.error(f"❌ Script execution error: {e}", exc_info=True)
            return {
                "success": False,
                "stdout": "",
                "stderr": str(e),
                "returncode": -1
            }


class BrowserAutomationService:
    """
    High-level browser automation service that integrates with LangGraph.
    
    Provides simple methods for common browser tasks:
    - navigate(url)
    - click(selector_or_ref)
    - type(selector_or_ref, text)
    - screenshot()
    - get_snapshot() - AI-friendly element tree
    - extract_text()
    """
    
    def __init__(self, headless: bool = False):
        self.server = BrowserServer(headless=headless)
        self.client = BrowserClient()
        self._started = False
    
    async def ensure_started(self) -> bool:
        """Ensure the browser server is running"""
        # First check if server is already running (maybe started externally)
        if await self.client.health_check():
            logger.info("✅ Browser server already running (external)")
            self._started = True
            return True
        
        if self._started:
            # We thought it was started but health check failed
            logger.warning("⚠️ Browser server was started but health check failed")
            self._started = False
        
        # Try to start the server
        success = await self.server.start()
        if success:
            # Wait for server to be accessible
            for _ in range(20):
                if await self.client.health_check():
                    self._started = True
                    logger.info("✅ Browser server started and healthy")
                    return True
                await asyncio.sleep(0.5)
        
        logger.error("❌ Browser server failed to start or become healthy")
        return False
    
    async def check_electron_available(self) -> bool:
        """Check if Electron app is running with remote debugging enabled"""
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(f"http://localhost:{ELECTRON_DEBUG_PORT}/json/version", timeout=aiohttp.ClientTimeout(total=2)) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        logger.info(f"✅ Electron app available: {data.get('Browser', 'Unknown')}")
                        return True
        except Exception as e:
            logger.debug(f"Electron app not available: {e}")
        return False
    
    async def get_electron_browser_ws_endpoint(self) -> Optional[str]:
        """Get the Electron app's browser WebSocket endpoint for Playwright connection"""
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(f"http://localhost:{ELECTRON_DEBUG_PORT}/json/version", timeout=aiohttp.ClientTimeout(total=2)) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        ws_url = data.get("webSocketDebuggerUrl")
                        if ws_url:
                            logger.info(f"✅ Got Electron browser endpoint: {ws_url}")
                            return ws_url
        except Exception as e:
            logger.debug(f"Failed to get Electron browser endpoint: {e}")
        return None
    
    async def get_electron_webview_target(self) -> Optional[str]:
        """Get the WebSocket URL for the Electron webview target (not the main window)"""
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(f"http://localhost:{ELECTRON_DEBUG_PORT}/json/list", timeout=aiohttp.ClientTimeout(total=2)) as resp:
                    if resp.status == 200:
                        targets = await resp.json()
                        
                        # Log all targets for debugging
                        for target in targets:
                            target_type = target.get("type", "")
                            target_url = target.get("url", "")
                            target_title = target.get("title", "")
                            logger.info(f"CDP Target: type={target_type}, title={target_title}, url={target_url[:60]}")
                        
                        # PRIORITY 1: Look for actual webview type
                        for target in targets:
                            if target.get("type") == "webview":
                                ws_url = target.get("webSocketDebuggerUrl")
                                if ws_url:
                                    logger.info(f"✅ Found webview target: {ws_url}")
                                    return ws_url
                        
                        # PRIORITY 2: Look for pages that are NOT the main Velora app
                        # (i.e., not localhost:3000/3001 and not devtools)
                        for target in targets:
                            target_type = target.get("type", "")
                            target_url = target.get("url", "")
                            
                            if target_type == "page":
                                # Skip the main Velora window
                                if "localhost:3000" in target_url or "localhost:3001" in target_url:
                                    continue
                                # Skip devtools
                                if "devtools" in target_url.lower():
                                    continue
                                # This might be the webview content
                                ws_url = target.get("webSocketDebuggerUrl")
                                if ws_url:
                                    logger.info(f"✅ Found potential webview page: {ws_url}")
                                    return ws_url
                        
                        logger.warning("⚠️ No webview target found - webview may not be open yet")
        except Exception as e:
            logger.error(f"Failed to get Electron targets: {e}")
        return None
    
    async def _find_webview_cdp_target(self) -> Optional[str]:
        """Alias for get_electron_webview_target - finds the webview's CDP WebSocket URL"""
        return await self.get_electron_webview_target()
    
    async def _find_any_webview(self) -> Optional[str]:
        """
        Find ANY webview CDP target without URL matching.
        
        This is simpler and more reliable than waiting for a specific URL.
        The webview will be navigated to the correct URL by Playwright after connection.
        """
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(f"http://localhost:{ELECTRON_DEBUG_PORT}/json/list", timeout=aiohttp.ClientTimeout(total=2)) as resp:
                    if resp.status == 200:
                        targets = await resp.json()
                        
                        # Log what we find for debugging
                        for target in targets:
                            target_type = target.get("type", "")
                            target_url = target.get("url", "")[:50]
                            logger.debug(f"CDP Target: type={target_type}, url={target_url}")
                        
                        # PRIORITY 1: Look for actual webview type
                        for target in targets:
                            if target.get("type") == "webview":
                                ws_url = target.get("webSocketDebuggerUrl")
                                if ws_url:
                                    logger.info(f"✅ Found webview target: {ws_url}")
                                    return ws_url
                        
                        # PRIORITY 2: Look for pages NOT in localhost (probably webview content)
                        for target in targets:
                            target_type = target.get("type", "")
                            target_url = target.get("url", "")
                            
                            if target_type == "page":
                                # Skip the main Velora window
                                if "localhost:3000" in target_url or "localhost:3001" in target_url:
                                    continue
                                if "devtools" in target_url.lower():
                                    continue
                                # Found external page - likely webview content
                                ws_url = target.get("webSocketDebuggerUrl")
                                if ws_url:
                                    logger.info(f"✅ Found external page (likely webview): {ws_url}")
                                    return ws_url
        except asyncio.TimeoutError:
            logger.debug("Timeout connecting to CDP endpoint")
        except Exception as e:
            logger.debug(f"Error finding webview: {e}")
        return None
    
    async def _find_webview_with_url(self, expected_url: str) -> Optional[str]:
        """Find a webview CDP target that has loaded the expected URL"""
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(f"http://localhost:{ELECTRON_DEBUG_PORT}/json/list", timeout=aiohttp.ClientTimeout(total=2)) as resp:
                    if resp.status == 200:
                        targets = await resp.json()
                        
                        # Look for webview with the expected URL
                        for target in targets:
                            target_type = target.get("type", "")
                            target_url = target.get("url", "")
                            
                            # Must be a webview type
                            if target_type == "webview":
                                # Check if URL matches (allow partial match for google.com variations)
                                expected_domain = expected_url.replace("https://", "").replace("http://", "").split("/")[0]
                                target_domain = target_url.replace("https://", "").replace("http://", "").split("/")[0]
                                
                                if expected_domain in target_domain or target_domain in expected_domain:
                                    ws_url = target.get("webSocketDebuggerUrl")
                                    if ws_url:
                                        logger.info(f"✅ Found webview with URL {target_url}")
                                        return ws_url
                        
                        # Log what we did find
                        webviews = [t for t in targets if t.get("type") == "webview"]
                        if webviews:
                            logger.debug(f"Found {len(webviews)} webviews but none with URL containing {expected_url[:30]}")
                            for wv in webviews:
                                logger.debug(f"  - {wv.get('url', 'no url')}")
        except Exception as e:
            logger.debug(f"Error finding webview: {e}")
        return None
    
    def _normalize_url(self, url: str) -> str:
        """Ensure URL has a proper protocol prefix"""
        url = url.strip()
        if not url:
            return "https://google.com"
        
        # If it's a search query (not a URL), use Google search
        if " " in url and not url.startswith("http"):
            query = url.replace(" ", "+")
            return f"https://www.google.com/search?q={query}"
        
        # Add https:// if no protocol
        if not url.startswith("http://") and not url.startswith("https://"):
            url = "https://" + url
        
        return url
    
    async def navigate(self, url: str, page_name: str = "main") -> BrowserResult:
        """Navigate to a URL"""
        if not await self.ensure_started():
            return BrowserResult(
                success=False,
                message="Browser server not running"
            )
        
        # Normalize the URL
        url = self._normalize_url(url)
        logger.info(f"🌐 Navigating to: {url}")
        
        script = f'''
import {{ connect, waitForPageLoad }} from "@/client.js";

const client = await connect();
const page = await client.page("{page_name}");

await page.goto("{url}");
await waitForPageLoad(page);

console.log(JSON.stringify({{
    url: page.url(),
    title: await page.title()
}}));

await client.disconnect();
'''
        
        result = await self.client.execute_script(script)
        
        if result["success"]:
            try:
                import json
                output = json.loads(result["stdout"].strip())
                return BrowserResult(
                    success=True,
                    message=f"Navigated to {output.get('title', url)}",
                    data=output
                )
            except:
                return BrowserResult(
                    success=True,
                    message=f"Navigated to {url}",
                    data={"url": url}
                )
        else:
            return BrowserResult(
                success=False,
                message=f"Navigation failed: {result['stderr']}"
            )
    
    async def get_ai_snapshot(self, page_name: str = "main") -> BrowserResult:
        """Get AI-friendly snapshot of page elements (ARIA tree with refs)"""
        if not await self.ensure_started():
            return BrowserResult(
                success=False,
                message="Browser server not running"
            )
        
        script = f'''
import {{ connect }} from "@/client.js";

const client = await connect();
const snapshot = await client.getAISnapshot("{page_name}");
console.log(snapshot);
await client.disconnect();
'''
        
        result = await self.client.execute_script(script)
        
        if result["success"]:
            return BrowserResult(
                success=True,
                message="Got page snapshot",
                snapshot=result["stdout"].strip()
            )
        else:
            return BrowserResult(
                success=False,
                message=f"Failed to get snapshot: {result['stderr']}"
            )
    
    async def click(self, ref: str, page_name: str = "main") -> BrowserResult:
        """Click an element by ref (from snapshot) or selector"""
        if not await self.ensure_started():
            return BrowserResult(
                success=False,
                message="Browser server not running"
            )
        
        # Check if it's a ref (e.g., "e5") or a CSS selector
        if ref.startswith("e") and ref[1:].isdigit():
            # It's a snapshot ref
            script = f'''
import {{ connect, waitForPageLoad }} from "@/client.js";

const client = await connect();
const element = await client.selectSnapshotRef("{page_name}", "{ref}");
await element.click();
await waitForPageLoad(client.page("{page_name}"));
console.log("Clicked element {ref}");
await client.disconnect();
'''
        else:
            # It's a CSS selector
            script = f'''
import {{ connect, waitForPageLoad }} from "@/client.js";

const client = await connect();
const page = await client.page("{page_name}");
await page.click("{ref}");
await waitForPageLoad(page);
console.log("Clicked selector {ref}");
await client.disconnect();
'''
        
        result = await self.client.execute_script(script)
        
        return BrowserResult(
            success=result["success"],
            message=result["stdout"].strip() if result["success"] else result["stderr"]
        )
    
    async def type_text(
        self, 
        ref: str, 
        text: str, 
        page_name: str = "main",
        submit: bool = False
    ) -> BrowserResult:
        """Type text into an element"""
        if not await self.ensure_started():
            return BrowserResult(
                success=False,
                message="Browser server not running"
            )
        
        # Escape the text for JavaScript
        escaped_text = text.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")
        
        submit_code = "await page.keyboard.press('Enter');" if submit else ""
        
        if ref.startswith("e") and ref[1:].isdigit():
            script = f'''
import {{ connect, waitForPageLoad }} from "@/client.js";

const client = await connect();
const page = await client.page("{page_name}");
const element = await client.selectSnapshotRef("{page_name}", "{ref}");
await element.fill("{escaped_text}");
{submit_code}
await waitForPageLoad(page);
console.log("Typed text into {ref}");
await client.disconnect();
'''
        else:
            script = f'''
import {{ connect, waitForPageLoad }} from "@/client.js";

const client = await connect();
const page = await client.page("{page_name}");
await page.fill("{ref}", "{escaped_text}");
{submit_code}
await waitForPageLoad(page);
console.log("Typed text into {ref}");
await client.disconnect();
'''
        
        result = await self.client.execute_script(script)
        
        return BrowserResult(
            success=result["success"],
            message=result["stdout"].strip() if result["success"] else result["stderr"]
        )
    
    async def screenshot(
        self, 
        page_name: str = "main",
        full_page: bool = False,
        output_path: Optional[str] = None
    ) -> BrowserResult:
        """Take a screenshot of the page"""
        if not await self.ensure_started():
            return BrowserResult(
                success=False,
                message="Browser server not running"
            )
        
        if output_path is None:
            import tempfile
            output_path = tempfile.mktemp(suffix=".png")
        
        full_page_opt = "fullPage: true," if full_page else ""
        
        script = f'''
import {{ connect }} from "@/client.js";

const client = await connect();
const page = await client.page("{page_name}");
await page.screenshot({{ path: "{output_path}", {full_page_opt} }});
console.log("{output_path}");
await client.disconnect();
'''
        
        result = await self.client.execute_script(script)
        
        if result["success"]:
            return BrowserResult(
                success=True,
                message=f"Screenshot saved to {output_path}",
                screenshot_path=output_path
            )
        else:
            return BrowserResult(
                success=False,
                message=f"Screenshot failed: {result['stderr']}"
            )
    
    async def extract_text(self, page_name: str = "main") -> BrowserResult:
        """Extract all text from the page"""
        if not await self.ensure_started():
            return BrowserResult(
                success=False,
                message="Browser server not running"
            )
        
        script = f'''
import {{ connect }} from "@/client.js";

const client = await connect();
const page = await client.page("{page_name}");
const text = await page.textContent("body");
console.log(text);
await client.disconnect();
'''
        
        result = await self.client.execute_script(script)
        
        if result["success"]:
            return BrowserResult(
                success=True,
                message="Extracted page text",
                data={"text": result["stdout"].strip()}
            )
        else:
            return BrowserResult(
                success=False,
                message=f"Text extraction failed: {result['stderr']}"
            )
    
    async def scroll(
        self, 
        direction: str = "down", 
        amount: int = 500, 
        page_name: str = "main"
    ) -> BrowserResult:
        """
        Scroll the page in a direction.
        
        Args:
            direction: "up", "down", "left", "right"
            amount: Pixels to scroll
            page_name: Name of the page to scroll
        """
        if not await self.ensure_started():
            return BrowserResult(
                success=False,
                message="Browser server not running"
            )
        
        # Convert direction to x,y delta
        scroll_map = {
            "down": (0, amount),
            "up": (0, -amount),
            "right": (amount, 0),
            "left": (-amount, 0)
        }
        
        delta_x, delta_y = scroll_map.get(direction.lower(), (0, amount))
        
        script = f'''
import {{ connect }} from "@/client.js";

const client = await connect();
const page = await client.page("{page_name}");
await page.mouse.wheel({delta_x}, {delta_y});
await new Promise(resolve => setTimeout(resolve, 300));
console.log("Scrolled {direction} by {amount}px");
await client.disconnect();
'''
        
        result = await self.client.execute_script(script)
        
        return BrowserResult(
            success=result["success"],
            message=f"Scrolled {direction}" if result["success"] else f"Scroll failed: {result['stderr']}"
        )
    
    async def click_ref(self, ref: str, page_name: str = "main") -> BrowserResult:
        """Click an element by its snapshot ref (alias for click)"""
        return await self.click(ref, page_name)
    
    async def type_in_ref(
        self, 
        ref: str, 
        text: str, 
        page_name: str = "main",
        submit: bool = False
    ) -> BrowserResult:
        """Type text into an element by its snapshot ref (alias for type_text)"""
        return await self.type_text(ref, text, page_name, submit)
    
    async def take_screenshot(
        self,
        output_path: str,
        page_name: str = "main",
        full_page: bool = False
    ) -> BrowserResult:
        """Take a screenshot (alias for screenshot with custom path)"""
        return await self.screenshot(page_name, full_page, output_path)
    
    async def research(self, query: str, page_name: str = "research") -> BrowserResult:
        """
        Research a topic by searching Google and extracting results.
        
        This is a high-level action that:
        1. Navigates to Google
        2. Searches for the query
        3. Returns search results
        """
        if not await self.ensure_started():
            return BrowserResult(
                success=False,
                message="Browser server not running"
            )
        
        escaped_query = query.replace("\\", "\\\\").replace('"', '\\"')
        
        script = f'''
import {{ connect, waitForPageLoad }} from "@/client.js";

const client = await connect();
const page = await client.page("{page_name}");

// Navigate to Google
await page.goto("https://www.google.com");
await waitForPageLoad(page);

// Accept cookies if prompted (common in some regions)
try {{
    const acceptButton = await page.$('button:has-text("Accept")');
    if (acceptButton) await acceptButton.click();
}} catch {{}}

// Search
await page.fill('textarea[name="q"], input[name="q"]', "{escaped_query}");
await page.keyboard.press("Enter");
await waitForPageLoad(page);

// Extract search results
const results = await page.evaluate(() => {{
    const items = [];
    const resultElements = document.querySelectorAll('div.g');
    resultElements.forEach((el, i) => {{
        if (i < 5) {{
            const titleEl = el.querySelector('h3');
            const linkEl = el.querySelector('a');
            const snippetEl = el.querySelector('div[data-sncf]') || el.querySelector('span');
            if (titleEl && linkEl) {{
                items.push({{
                    title: titleEl.textContent,
                    url: linkEl.href,
                    snippet: snippetEl ? snippetEl.textContent : ''
                }});
            }}
        }}
    }});
    return items;
}});

console.log(JSON.stringify(results, null, 2));
await client.disconnect();
'''
        
        result = await self.client.execute_script(script)
        
        if result["success"]:
            try:
                import json
                results = json.loads(result["stdout"].strip())
                return BrowserResult(
                    success=True,
                    message=f"Found {len(results)} results for '{query}'",
                    data={"query": query, "results": results}
                )
            except:
                return BrowserResult(
                    success=True,
                    message=f"Searched for '{query}'",
                    data={"query": query, "raw": result["stdout"]}
                )
        else:
            return BrowserResult(
                success=False,
                message=f"Research failed: {result['stderr']}"
            )
    
    async def shutdown(self):
        """Stop the browser server"""
        await self.client.close()
        await self.server.stop()
        self._started = False
    
    async def agentic_browse(
        self, 
        task: str, 
        starting_url: str = "https://www.google.com",
        max_steps: int = 10,
        page_name: str = "agent"
    ) -> BrowserResult:
        """
        Agentic browser automation - uses an LLM to navigate and interact with pages.
        
        This implements a true agent loop:
        1. Navigate to starting URL
        2. Get AI snapshot of the page
        3. Ask LLM what action to take
        4. Execute the action
        5. Repeat until task is complete or max_steps reached
        
        Args:
            task: The task to accomplish (e.g., "find pictures of cats")
            starting_url: Where to start (default: Google)
            max_steps: Maximum number of actions to take
            page_name: Name for the browser page
            
        Returns:
            BrowserResult with the outcome
        """
        from langchain_openai import ChatOpenAI
        from langchain_core.messages import SystemMessage, HumanMessage
        from backend.llm.config import config
        import json
        
        if not await self.ensure_started():
            return BrowserResult(
                success=False,
                message="Browser server not running"
            )
        
        logger.info(f"🤖 Starting agentic browse: {task}")
        
        # Navigate to starting URL
        nav_result = await self.navigate(starting_url, page_name)
        if not nav_result.success:
            return nav_result
        
        # LLM for decision making
        llm = ChatOpenAI(
            api_key=config.openai_api_key,
            model="gpt-4o",
            temperature=0,
        )
        
        action_history = []
        
        for step in range(max_steps):
            logger.info(f"🤖 Agent step {step + 1}/{max_steps}")
            
            # Get AI snapshot of current page
            snapshot_result = await self.get_ai_snapshot(page_name)
            if not snapshot_result.success:
                logger.warning(f"Failed to get snapshot: {snapshot_result.message}")
                continue
            
            snapshot = snapshot_result.snapshot or ""
            
            # Truncate snapshot if too long
            if len(snapshot) > 15000:
                snapshot = snapshot[:15000] + "\n... (truncated)"
            
            # Ask LLM what to do
            system_prompt = """You are a browser automation agent. You can see the current page as an ARIA snapshot.

Your task: {task}

Available actions:
1. CLICK [ref] - Click an element by its ref (e.g., "CLICK e5")
2. TYPE [ref] [text] - Type text into an element (e.g., "TYPE e3 cat pictures")
3. NAVIGATE [url] - Go to a URL (e.g., "NAVIGATE https://images.google.com")
4. SCROLL [direction] - Scroll the page (e.g., "SCROLL down")
5. DONE [reason] - Task is complete (e.g., "DONE Found the information requested")

Rules:
- Use refs from the snapshot (like e1, e2, e3...)
- For search boxes, use TYPE then press Enter by adding \\n at the end
- Click on links/buttons to navigate
- Say DONE when the task is accomplished

Respond with ONLY the action, nothing else. Example responses:
- CLICK e12
- TYPE e5 pictures of beaches\\n
- DONE I found several beach pictures on the page
""".format(task=task)
            
            human_prompt = f"""Current page snapshot:
{snapshot}

Previous actions taken:
{json.dumps(action_history[-5:], indent=2) if action_history else "None yet"}

What action should I take next to accomplish: {task}"""
            
            try:
                response = await llm.ainvoke([
                    SystemMessage(content=system_prompt),
                    HumanMessage(content=human_prompt)
                ])
                
                action = response.content.strip()
                logger.info(f"🤖 Agent decided: {action}")
                action_history.append({"step": step + 1, "action": action})
                
                # Parse and execute the action
                if action.upper().startswith("DONE"):
                    reason = action[4:].strip() if len(action) > 4 else "Task completed"
                    return BrowserResult(
                        success=True,
                        message=f"Task completed: {reason}",
                        data={
                            "task": task,
                            "steps_taken": step + 1,
                            "action_history": action_history
                        }
                    )
                
                elif action.upper().startswith("CLICK"):
                    ref = action.split()[1] if len(action.split()) > 1 else ""
                    if ref:
                        click_result = await self.click(ref, page_name)
                        logger.info(f"🤖 Click result: {click_result.message}")
                        # Wait for page to update
                        await asyncio.sleep(1)
                
                elif action.upper().startswith("TYPE"):
                    parts = action.split(maxsplit=2)
                    if len(parts) >= 3:
                        ref = parts[1]
                        text = parts[2]
                        submit = text.endswith("\\n")
                        if submit:
                            text = text[:-2]
                        type_result = await self.type_text(ref, text, page_name, submit=submit)
                        logger.info(f"🤖 Type result: {type_result.message}")
                        await asyncio.sleep(1)
                
                elif action.upper().startswith("NAVIGATE"):
                    url = action.split(maxsplit=1)[1] if len(action.split()) > 1 else ""
                    if url:
                        nav_result = await self.navigate(url, page_name)
                        logger.info(f"🤖 Navigate result: {nav_result.message}")
                
                elif action.upper().startswith("SCROLL"):
                    direction = action.split()[1] if len(action.split()) > 1 else "down"
                    # Simple scroll implementation
                    scroll_script = f'''
import {{ connect }} from "@/client.js";
const client = await connect();
const page = await client.page("{page_name}");
await page.evaluate(() => window.scrollBy(0, {"500" if direction == "down" else "-500"}));
await client.disconnect();
'''
                    await self.client.execute_script(scroll_script)
                    await asyncio.sleep(0.5)
                
                else:
                    logger.warning(f"🤖 Unknown action: {action}")
                    
            except Exception as e:
                logger.error(f"🤖 Agent error at step {step + 1}: {e}")
                action_history.append({"step": step + 1, "error": str(e)})
        
        # Max steps reached
        return BrowserResult(
            success=True,
            message=f"Reached maximum steps ({max_steps}). Task may be partially complete.",
            data={
                "task": task,
                "steps_taken": max_steps,
                "action_history": action_history
            }
        )
    
    async def agentic_browse_streaming(
        self, 
        task: str, 
        starting_url: str = "https://www.google.com",
        max_steps: int = 10,
        page_name: str = "agent",
        on_event: Optional[Callable[[Dict[str, Any]], None]] = None
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """
        Streaming version of agentic_browse that yields action events.
        
        PRIORITY: If Electron app is running, connects to the embedded webview
        so the user sees the agent work in real-time within Velora.
        
        Falls back to dev-browser server if Electron is not available.
        
        Yields events with types:
        - 'open': Browser opened, includes URL
        - 'action': Action being performed (for reasoning display)
        - 'url': URL changed (for webview navigation)
        - 'error': An error occurred
        - 'complete': Task finished
        
        Args:
            task: The task to accomplish
            starting_url: Where to start
            max_steps: Maximum number of actions
            page_name: Name for the browser page
            on_event: Optional callback for real-time event streaming (pushes to SSE immediately)
        """
        from langchain_openai import ChatOpenAI
        from langchain_core.messages import SystemMessage, HumanMessage
        from backend.llm.config import config
        
        # Auto-get callback from context if not provided explicitly
        # This enables real-time streaming to SSE without changing the entire call chain
        # Check if Electron app is running - if so, use its webview for real-time display
        if await self.check_electron_available():
            logger.info("🖥️ Electron app detected - attempting real-time webview control")
            async for event in self._agentic_browse_electron(task, starting_url, max_steps, on_event):
                yield event
            return
        
        # Fall back to dev-browser server
        logger.info("📡 Using dev-browser server (Electron not available)")
        if not await self.ensure_started():
            yield {
                "type": "error",
                "error": "Browser server not running",
                "is_loading": False
            }
            return
        
        # Emit browser open event
        yield {
            "type": "open",
            "url": starting_url,
            "is_loading": True
        }
        
        logger.info(f"🤖 Starting streaming agentic browse: {task}")
        
        # Navigate to starting URL
        nav_result = await self.navigate(starting_url, page_name)
        if not nav_result.success:
            yield {
                "type": "error",
                "error": nav_result.message,
                "is_loading": False
            }
            return
        
        # Emit URL update
        yield {
            "type": "url",
            "url": starting_url,
            "is_loading": False
        }
        
        # LLM for decision making
        llm = ChatOpenAI(
            api_key=config.openai_api_key,
            model="gpt-4o",
            temperature=0,
        )
        
        action_history = []
        
        try:
            for step in range(max_steps):
                logger.info(f"🤖 Agent step {step + 1}/{max_steps}")
                
                # Get AI snapshot of current page
                snapshot_result = await self.get_ai_snapshot(page_name)
                if not snapshot_result.success:
                    logger.warning(f"Failed to get snapshot: {snapshot_result.message}")
                    continue
                
                snapshot = snapshot_result.snapshot or ""
                
                # Truncate snapshot if too long
                if len(snapshot) > 15000:
                    snapshot = snapshot[:15000] + "\n... (truncated)"
                
                # Ask LLM what to do
                system_prompt = """You are a browser automation agent. You can see the current page as an ARIA snapshot.

Your task: {task}

Available actions:
1. CLICK [ref] - Click an element by its ref (e.g., "CLICK e5")
2. TYPE [ref] [text] - Type text into an element (e.g., "TYPE e42 cat pictures\\n")
3. NAVIGATE [url] - Go to a URL (e.g., "NAVIGATE https://images.google.com")
4. SCROLL [direction] - Scroll the page (e.g., "SCROLL down")
5. DONE [reason] - Task is complete (e.g., "DONE Search results are now displayed")

IMPORTANT RULES:
- Find the search input (usually a combobox or textbox with "Search" label)
- Use TYPE [ref] [search terms]\\n to type AND submit (the \\n presses Enter)
- Wait for search results before saying DONE
- Only say DONE after you see actual search results on the page
- DO NOT say DONE if you're still on the homepage or haven't searched yet

Example for searching on Google:
1. See "combobox Search [ref=e42]" in snapshot
2. TYPE e42 cat pictures\\n
3. After search results load, say DONE

Respond with ONLY the action, nothing else.""".format(task=task)
                
                human_prompt = f"""Current page snapshot:
{snapshot}

Previous actions taken:
{json.dumps(action_history[-5:], indent=2) if action_history else "None yet"}

What action should I take next to accomplish: {task}"""
                
                try:
                    response = await llm.ainvoke([
                        SystemMessage(content=system_prompt),
                        HumanMessage(content=human_prompt)
                    ])
                    
                    action = response.content.strip()
                    logger.info(f"🤖 Agent decided: {action}")
                    action_history.append({"step": step + 1, "action": action})
                    
                    # Emit action event
                    yield {
                        "type": "action",
                        "action": f"Step {step + 1}: {action}",
                        "is_loading": True
                    }
                    
                    # Parse and execute the action
                    if action.upper().startswith("DONE"):
                        reason = action[4:].strip() if len(action) > 4 else "Task completed"
                        
                        yield {
                            "type": "complete",
                            "message": f"Task completed: {reason}",
                            "steps_taken": step + 1,
                            "action_history": action_history,
                            "is_loading": False
                        }
                        return
                    
                    elif action.upper().startswith("CLICK"):
                        ref = action.split()[1] if len(action.split()) > 1 else ""
                        if ref:
                            click_result = await self.click(ref, page_name)
                            logger.info(f"🤖 Click result: {click_result.message}")
                            await asyncio.sleep(0.8)
                    
                    elif action.upper().startswith("TYPE"):
                        parts = action.split(maxsplit=2)
                        if len(parts) >= 3:
                            ref = parts[1]
                            text = parts[2]
                            submit = text.endswith("\\n")
                            if submit:
                                text = text[:-2]
                            type_result = await self.type_text(ref, text, page_name, submit=submit)
                            logger.info(f"🤖 Type result: {type_result.message}")
                            await asyncio.sleep(1)
                    
                    elif action.upper().startswith("NAVIGATE"):
                        url = action.split(maxsplit=1)[1] if len(action.split()) > 1 else ""
                        if url:
                            nav_result = await self.navigate(url, page_name)
                            logger.info(f"🤖 Navigate result: {nav_result.message}")
                            yield {
                                "type": "url",
                                "url": url,
                                "is_loading": True
                            }
                            await asyncio.sleep(1)
                    
                    elif action.upper().startswith("SCROLL"):
                        direction = action.split()[1] if len(action.split()) > 1 else "down"
                        scroll_script = f'''
import {{ connect }} from "@/client.js";
const client = await connect();
const page = await client.page("{page_name}");
await page.evaluate(() => window.scrollBy(0, {"500" if direction == "down" else "-500"}));
await client.disconnect();
'''
                        await self.client.execute_script(scroll_script)
                        await asyncio.sleep(0.5)
                    
                    else:
                        logger.warning(f"🤖 Unknown action: {action}")
                        
                except Exception as e:
                    logger.error(f"🤖 Agent error at step {step + 1}: {e}")
                    action_history.append({"step": step + 1, "error": str(e)})
                    yield {
                        "type": "error",
                        "error": str(e),
                        "is_loading": False
                    }
            
            # Max steps reached
            yield {
                "type": "complete",
                "message": f"Reached maximum steps ({max_steps}). Task may be partially complete.",
                "steps_taken": max_steps,
                "action_history": action_history,
                "is_loading": False
            }
        
        finally:
            # Clean up any resources
            pass
    
    async def _agentic_browse_electron(
        self, 
        task: str, 
        starting_url: str = "https://www.google.com",
        max_steps: int = 10,
        on_event: Optional[Callable[[Dict[str, Any]], None]] = None
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """
        Agentic browsing that controls the Electron webview DIRECTLY.
        
        Connects Playwright to the actual embedded webview so the user
        sees all actions (typing, clicking, scrolling) happen in real-time.
        
        Args:
            on_event: Callback for real-time event streaming to SSE
        """
        from langchain_openai import ChatOpenAI
        from langchain_core.messages import SystemMessage, HumanMessage
        from backend.llm.config import config
        
        if async_playwright is None:
            raise ImportError("playwright is not installed. Install it with: pip install playwright")
        
        # Helper to emit event via both callback AND yield
        def emit(event: Dict[str, Any]):
            if on_event:
                try:
                    on_event(event)  # Push immediately to SSE queue
                except Exception as e:
                    logger.warning(f"on_event callback error: {e}")
        
        # Tell frontend to open webview shell (NO URL - backend will navigate via CDP)
        # This prevents race conditions where frontend and backend both try to navigate
        open_event = {
            "type": "open",
            "url": None,  # Don't set URL - backend will navigate after connecting
            "is_loading": True
        }
        emit(open_event)
        yield open_event
        
        # Wait for webview to be created (it will start at about:blank)
        # The frontend needs time to: 1) receive the open event, 2) render webview, 3) register CDP
        logger.info(f"🖥️ Waiting for Electron webview to appear (will navigate to {starting_url} after connect)...")
        webview_ws_url = None
        
        # Simple detection: just find any webview target (no URL matching needed)
        for attempt in range(40):  # Wait up to 20 seconds
            await asyncio.sleep(0.5)
            webview_ws_url = await self._find_any_webview()
            if webview_ws_url:
                logger.info(f"✅ Found webview CDP target: {webview_ws_url}")
                break
            if attempt % 5 == 0:
                logger.info(f"⏳ Waiting for webview... attempt {attempt + 1}/40")
        
        if not webview_ws_url:
            logger.warning("⚠️ Could not find webview CDP target, falling back to headless browser")
            # Fall back to headless mode (pass on_event to headless too)
            async for event in self._agentic_browse_headless(task, starting_url, max_steps, on_event):
                yield event
            return
        
        # Connect DIRECTLY to the webview's CDP endpoint (not the browser endpoint!)
        # Connecting to the browser endpoint can cause EPIPE errors in Electron.
        # The webview has its own CDP endpoint that we can connect to safely.
        logger.info(f"🖥️ Connecting Playwright directly to webview: {webview_ws_url}")
        
        # Retry CDP connection with backoff (webview may not be fully ready)
        browser = None
        page = None
        max_connection_retries = 3
        
        async with async_playwright() as p:
            for retry in range(max_connection_retries):
                try:
                    # Connect directly to the webview's CDP endpoint
                    browser = await p.chromium.connect_over_cdp(webview_ws_url)
                    
                    # Wait a moment for connection to stabilize
                    await asyncio.sleep(0.5)
                    
                    # When connecting to a specific page's CDP endpoint, Playwright creates
                    # a default context with that page. Try multiple ways to find it.
                    
                    # Method 1: Check contexts
                    for context in browser.contexts:
                        if context.pages:
                            page = context.pages[0]
                            logger.info(f"✅ Found page in context: {page.url}")
                            break
                    
                    # Method 2: If no page in contexts, the webview might be the browser's "default" page
                    # Try creating a new page in the existing context
                    if not page and browser.contexts:
                        logger.info("🔍 No page in context, checking if we can use the connected target...")
                        # The connection itself IS to the webview - we need to work with it differently
                        # Try getting pages from the browser directly
                        try:
                            # Some Playwright versions expose pages differently
                            all_contexts = browser.contexts
                            logger.info(f"🔍 Browser has {len(all_contexts)} contexts")
                            for idx, ctx in enumerate(all_contexts):
                                logger.info(f"  Context {idx}: {len(ctx.pages)} pages")
                                for pidx, pg in enumerate(ctx.pages):
                                    logger.info(f"    Page {pidx}: {pg.url}")
                        except Exception as e:
                            logger.warning(f"Error enumerating: {e}")
                    
                    if page:
                        break
                    else:
                        if retry < max_connection_retries - 1:
                            logger.warning(f"⚠️ No page found in webview connection (attempt {retry + 1}/{max_connection_retries}), retrying...")
                            try:
                                await browser.close()
                            except:
                                pass
                            await asyncio.sleep(1 * (retry + 1))  # Exponential backoff
                            continue
                        
                        # Last resort: fall back to headless browser
                        logger.warning("⚠️ Could not get page from webview, falling back to headless browser")
                        try:
                            await browser.close()
                        except:
                            pass
                        async for event in self._agentic_browse_headless(task, starting_url, max_steps, on_event):
                            yield event
                        return
                    
                except Exception as conn_error:
                    logger.warning(f"⚠️ CDP connection failed (attempt {retry + 1}/{max_connection_retries}): {conn_error}")
                    if retry < max_connection_retries - 1:
                        await asyncio.sleep(1 * (retry + 1))  # Exponential backoff
                    else:
                        # Fall back to headless browser instead of erroring
                        logger.warning("⚠️ CDP connection failed, falling back to headless browser")
                        async for event in self._agentic_browse_headless(task, starting_url, max_steps, on_event):
                            yield event
                        return
            
            if not page:
                # Fall back to headless browser
                logger.warning("⚠️ Failed to get page from webview, falling back to headless browser")
                try:
                    await browser.close()
                except:
                    pass
                async for event in self._agentic_browse_headless(task, starting_url, max_steps, on_event):
                    yield event
                return

            try:
                # Wait for page to be stable before navigating
                try:
                    await page.wait_for_load_state("domcontentloaded", timeout=5000)
                except Exception as e:
                    logger.debug(f"Initial wait for load state: {e}")
                
                # ALWAYS navigate since webview starts at about:blank
                # Backend controls all navigation - frontend doesn't pre-load URLs
                nav_event = {"type": "action", "action": f"Navigating to {starting_url}", "is_loading": True}
                emit(nav_event)
                yield nav_event
                
                logger.info(f"🌐 Navigating webview to: {starting_url}")
                await page.goto(starting_url, wait_until="domcontentloaded", timeout=30000)
                
                # Wait for page to be interactive
                await page.wait_for_load_state("domcontentloaded", timeout=10000)
                logger.info(f"🌐 Webview loaded: {page.url}")
                
                # Emit URL update so frontend can update URL bar display
                url_event = {"type": "url", "url": page.url, "is_loading": False}
                emit(url_event)
                yield url_event
                
                # LLM for decision making
                llm = ChatOpenAI(
                    api_key=config.openai_api_key,
                    model="gpt-4o",
                    temperature=0,
                )
                
                action_history = []
                
                for step in range(max_steps):
                    logger.info(f"🤖 Agent step {step + 1}/{max_steps}")
                    
                    # Get accessibility snapshot
                    try:
                        snapshot = await page.accessibility.snapshot()
                        snapshot_str = json.dumps(snapshot, indent=2) if snapshot else "Page empty"
                    except Exception as e:
                        logger.warning(f"Failed to get accessibility snapshot: {e}")
                        snapshot_str = "Could not get page snapshot"
                    
                    # Truncate if too long
                    if len(snapshot_str) > 15000:
                        snapshot_str = snapshot_str[:15000] + "\n... (truncated)"
                    
                    # Ask LLM what to do
                    system_prompt = f"""You are a browser automation agent controlling a real browser.
                    
Your task: {task}

Available actions:
1. CLICK [selector] - Click an element (e.g., "CLICK input[name='q']" or "CLICK text=Search")
2. TYPE [selector] [text] - Type text (e.g., "TYPE input[name='q'] cat pictures")
3. PRESS Enter - Press Enter key
4. NAVIGATE [url] - Go to a URL
5. SCROLL down/up - Scroll the page
6. DONE [reason] - Task complete

Current page URL: {page.url}

Use Playwright selectors (text=, role=, input[name=], etc.)
Respond with ONLY the action, nothing else."""

                    human_prompt = f"""Page accessibility tree:
{snapshot_str}

Previous actions: {json.dumps(action_history[-3:]) if action_history else "None"}

What action should I take?"""

                    try:
                        response = await llm.ainvoke([
                            SystemMessage(content=system_prompt),
                            HumanMessage(content=human_prompt)
                        ])
                        
                        action = response.content.strip()
                        logger.info(f"🤖 Agent decided: {action}")
                        action_history.append({"step": step + 1, "action": action})
                        
                        # Emit action event - this goes to SSE IMMEDIATELY via callback
                        action_event = {"type": "action", "action": f"Step {step + 1}: {action}", "is_loading": True}
                        emit(action_event)
                        yield action_event
                        
                        # Execute action
                        if action.upper().startswith("DONE"):
                            reason = action[4:].strip() if len(action) > 4 else "Task completed"
                            complete_event = {
                                "type": "complete",
                                "message": f"Task completed: {reason}",
                                "steps_taken": step + 1,
                                "action_history": action_history,
                                "url": page.url,
                                "is_loading": False
                            }
                            emit(complete_event)
                            yield complete_event
                            return
                        
                        elif action.upper().startswith("CLICK"):
                            selector = action[5:].strip()
                            try:
                                # Click happens directly on the visible webview!
                                await page.click(selector, timeout=5000)
                                await page.wait_for_timeout(1000)
                                logger.info(f"✅ Clicked: {selector}")
                                # Emit URL update in case click caused navigation
                                url_event = {"type": "url", "url": page.url, "is_loading": False}
                                emit(url_event)
                                yield url_event
                            except Exception as e:
                                logger.warning(f"Click failed: {e}")
                        
                        elif action.upper().startswith("TYPE"):
                            parts = action[4:].strip().split(" ", 1)
                            if len(parts) >= 2:
                                selector, text = parts[0], parts[1]
                                try:
                                    await page.fill(selector, text)
                                    await page.wait_for_timeout(300)
                                except Exception as e:
                                    logger.warning(f"Type failed: {e}")
                        
                        elif action.upper().startswith("PRESS"):
                            key = action[5:].strip()
                            old_url = page.url
                            # Press key directly on the visible webview!
                            await page.keyboard.press(key)
                            # Wait for navigation if pressing Enter
                            if key.lower() == "enter":
                                try:
                                    await page.wait_for_url(lambda url: url != old_url, timeout=5000)
                                except Exception:
                                    pass
                            await page.wait_for_timeout(1000)
                            logger.info(f"✅ Pressed {key}, URL: {old_url} → {page.url}")
                            # Emit URL update (PRESS often causes navigation)
                            url_event = {"type": "url", "url": page.url, "is_loading": False}
                            emit(url_event)
                            yield url_event
                        
                        elif action.upper().startswith("NAVIGATE"):
                            nav_url = action[8:].strip()
                            # Navigate directly in the visible webview!
                            await page.goto(nav_url, wait_until="domcontentloaded")
                            await page.wait_for_timeout(1000)
                            logger.info(f"✅ Navigated to: {page.url}")
                            # Emit URL update
                            url_event = {"type": "url", "url": page.url, "is_loading": False}
                            emit(url_event)
                            yield url_event
                        
                        elif action.upper().startswith("SCROLL"):
                            direction = action[6:].strip().lower()
                            delta = 500 if direction == "down" else -500
                            await page.evaluate(f"window.scrollBy(0, {delta})")
                            await page.wait_for_timeout(300)
                        
                    except Exception as e:
                        logger.error(f"Agent error at step {step + 1}: {e}")
                        action_history.append({"step": step + 1, "error": str(e)})
                
                # Max steps reached
                max_event = {
                    "type": "complete",
                    "message": f"Reached maximum steps ({max_steps})",
                    "steps_taken": max_steps,
                    "action_history": action_history,
                    "url": page.url,
                    "is_loading": False
                }
                emit(max_event)
                yield max_event
                
            except Exception as e:
                logger.error(f"Browser automation error: {e}", exc_info=True)
                err_event = {"type": "error", "error": str(e), "is_loading": False}
                emit(err_event)
                yield err_event
            
            finally:
                # Don't close browser - it's the Electron app's browser!
                # We're just connected to it via CDP
                pass
    
    async def _agentic_browse_headless(
        self, 
        task: str, 
        starting_url: str = "https://www.google.com",
        max_steps: int = 10,
        on_event: Optional[Callable[[Dict[str, Any]], None]] = None
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """
        Fallback: Agentic browsing with headless browser.
        Used when Electron webview is not available.
        
        Args:
            on_event: Callback for real-time event streaming to SSE
        """
        from langchain_openai import ChatOpenAI
        
        if async_playwright is None:
            raise ImportError("playwright is not installed. Install it with: pip install playwright")
        from langchain_core.messages import SystemMessage, HumanMessage
        from backend.llm.config import config
        
        # Helper to emit event via callback
        def emit(event: Dict[str, Any]):
            if on_event:
                try:
                    on_event(event)
                except Exception as e:
                    logger.warning(f"on_event callback error: {e}")
        
        logger.info(f"🖥️ Using headless Playwright (Electron webview not available)")
        
        async with async_playwright() as p:
            try:
                browser = await p.chromium.launch(headless=True)
                context = await browser.new_context()
                page = await context.new_page()
                
                nav_event = {"type": "action", "action": f"Navigating to {starting_url}", "is_loading": True}
                emit(nav_event)
                yield nav_event
                await page.goto(starting_url, wait_until="domcontentloaded")
                await page.wait_for_timeout(500)
                
                url_event = {"type": "url", "url": page.url, "is_loading": False}
                emit(url_event)
                yield url_event
                
                llm = ChatOpenAI(api_key=config.openai_api_key, model="gpt-4o", temperature=0)
                action_history = []
                
                for step in range(max_steps):
                    try:
                        snapshot = await page.accessibility.snapshot()
                        snapshot_str = json.dumps(snapshot, indent=2) if snapshot else "Page empty"
                    except Exception:
                        snapshot_str = "Could not get page snapshot"
                    
                    if len(snapshot_str) > 15000:
                        snapshot_str = snapshot_str[:15000] + "\n... (truncated)"
                    
                    system_prompt = f"""You are a browser automation agent. Task: {task}
Actions: CLICK [selector], TYPE [selector] [text], PRESS Enter, NAVIGATE [url], SCROLL down/up, DONE [reason]
Current URL: {page.url}"""

                    human_prompt = f"Page snapshot:\n{snapshot_str}\nPrevious: {json.dumps(action_history[-3:]) if action_history else 'None'}\nAction?"
                    
                    try:
                        response = await llm.ainvoke([SystemMessage(content=system_prompt), HumanMessage(content=human_prompt)])
                        action = response.content.strip()
                        action_history.append({"step": step + 1, "action": action})
                        action_event = {"type": "action", "action": f"Step {step + 1}: {action}", "is_loading": True}
                        emit(action_event)
                        yield action_event
                        
                        if action.upper().startswith("DONE"):
                            complete_event = {"type": "complete", "message": action, "steps_taken": step + 1, "url": page.url, "is_loading": False}
                            emit(complete_event)
                            yield complete_event
                            return
                        elif action.upper().startswith("CLICK"):
                            await page.click(action[5:].strip(), timeout=5000)
                            url_event = {"type": "url", "url": page.url, "is_loading": False}
                            emit(url_event)
                            yield url_event
                        elif action.upper().startswith("TYPE"):
                            parts = action[4:].strip().split(" ", 1)
                            if len(parts) >= 2:
                                await page.fill(parts[0], parts[1])
                        elif action.upper().startswith("PRESS"):
                            await page.keyboard.press(action[5:].strip())
                            await page.wait_for_timeout(2000)
                            url_event = {"type": "url", "url": page.url, "is_loading": False}
                            emit(url_event)
                            yield url_event
                        elif action.upper().startswith("NAVIGATE"):
                            await page.goto(action[8:].strip(), wait_until="domcontentloaded")
                            url_event = {"type": "url", "url": page.url, "is_loading": False}
                            emit(url_event)
                            yield url_event
                        elif action.upper().startswith("SCROLL"):
                            delta = 500 if "down" in action.lower() else -500
                            await page.evaluate(f"window.scrollBy(0, {delta})")
                        
                        await page.wait_for_timeout(500)
                    except Exception as e:
                        logger.error(f"Agent error: {e}")
                
                max_event = {"type": "complete", "message": f"Max steps reached", "steps_taken": max_steps, "url": page.url, "is_loading": False}
                emit(max_event)
                yield max_event
                
            except Exception as e:
                err_event = {"type": "error", "error": str(e), "is_loading": False}
                emit(err_event)
                yield err_event
            finally:
                try:
                    await browser.close()
                except Exception:
                    pass


# Singleton instance
# Run browser in headless mode for automation - frontend shows embedded webview
browser_service = BrowserAutomationService(headless=True)
