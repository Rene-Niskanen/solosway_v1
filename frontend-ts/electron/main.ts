import { app, shell, BrowserWindow, ipcMain, session } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'

// Enable remote debugging so backend can connect to the webview
// Use port 9226 to avoid conflicts with dev-browser (9224/9225)
app.commandLine.appendSwitch('remote-debugging-port', '9226')

// Keep a global reference of the window object to prevent garbage collection
let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  // Create the browser window
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hiddenInset', // Native-looking title bar on Mac
    trafficLightPosition: { x: 15, y: 15 }, // Position traffic lights on Mac
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      // Enable webview tag for embedded browser
      webviewTag: true,
      // Enable node integration in webview for automation
      nodeIntegration: false,
      contextIsolation: true
    }
  })

  // Show window when ready
  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  // Handle external links - open in default browser
  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // Load the app
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    // Development: load from Vite dev server
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
    // Open DevTools in development
    mainWindow.webContents.openDevTools()
  } else {
    // Production: load from built files
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // Handle window close
  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// App lifecycle handlers
app.whenReady().then(() => {
  // Set app user model id for Windows
  electronApp.setAppUserModelId('com.velora.app')

  // Set Content Security Policy for security
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; " +
          "script-src 'self' 'unsafe-inline' https://unpkg.com; " +
          "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
          "font-src 'self' https://fonts.gstatic.com; " +
          "img-src 'self' data: https:; " +
          "connect-src 'self' http://localhost:* https://*; " +
          "frame-src 'self' https:; " +
          "object-src 'none'; " +
          "base-uri 'self';"
        ]
      }
    })
  })

  // Watch for shortcut keys in development
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // IPC Handlers for webview control
  setupIpcHandlers()

  createWindow()

  // macOS: re-create window when dock icon is clicked
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

// Quit when all windows are closed (except on macOS)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// Track the webview's web contents for CDP access
let agentWebContentsId: number | null = null

// Store event listeners for cleanup
const webviewEventListeners = new Map<number, {
  domReady: () => void;
  didFinishLoad: () => void;
  didStopLoading: () => void;
  didNavigate: (event: any, url: string) => void;
}>()

// Safe logging that won't crash on EPIPE
function safeLog(...args: unknown[]): void {
  try {
    console.log(...args)
  } catch {
    // Ignore EPIPE errors from broken pipes
  }
}

// IPC handlers for communication with renderer
function setupIpcHandlers(): void {
  // Handle webview registration - renderer tells us when webview is ready
  ipcMain.handle('webview:register', async (_event, webContentsId: number) => {
    safeLog('Webview registered with webContentsId:', webContentsId)
    agentWebContentsId = webContentsId
    
    // Set up event listeners for this webview
    try {
      const webContents = require('electron').webContents.fromId(webContentsId)
      if (webContents) {
        // Clean up any existing listeners
        const existing = webviewEventListeners.get(webContentsId)
        if (existing) {
          webContents.removeListener('dom-ready', existing.domReady)
          webContents.removeListener('did-finish-load', existing.didFinishLoad)
          webContents.removeListener('did-stop-loading', existing.didStopLoading)
          webContents.removeListener('did-navigate', existing.didNavigate)
        }
        
        // Create new event handlers (stored for potential future use)
        const handlers = {
          domReady: () => {
            // Event handler - can be used for logging or other purposes
            safeLog('Webview dom-ready event')
          },
          didFinishLoad: () => {
            safeLog('Webview did-finish-load event')
          },
          didStopLoading: () => {
            safeLog('Webview did-stop-loading event')
          },
          didNavigate: (_event: any, url: string) => {
            safeLog('Webview did-navigate event:', url)
          }
        }
        
        // Attach listeners
        webContents.on('dom-ready', handlers.domReady)
        webContents.on('did-finish-load', handlers.didFinishLoad)
        webContents.on('did-stop-loading', handlers.didStopLoading)
        webContents.on('did-navigate', handlers.didNavigate)
        
        // Store for cleanup
        webviewEventListeners.set(webContentsId, handlers)
        
        safeLog('Webview event listeners attached')
      }
    } catch (err) {
      safeLog('Failed to attach webview event listeners:', err)
    }
    
    return { success: true }
  })
  
  // Event-based waiting handlers - return Promises that resolve on events
  ipcMain.handle('webview:wait-for-dom-ready', async () => {
    if (!agentWebContentsId) {
      return { success: false, error: 'No webview registered' }
    }
    
    return new Promise((resolve) => {
      const webContents = require('electron').webContents.fromId(agentWebContentsId!)
      if (!webContents) {
        resolve({ success: false, error: 'WebContents not found' })
        return
      }
      
      // Check if already ready
      if (webContents.isLoading() === false) {
        resolve({ success: true })
        return
      }
      
      // Wait for dom-ready event
      const handler = () => {
        webContents.removeListener('dom-ready', handler)
        resolve({ success: true })
      }
      webContents.once('dom-ready', handler)
      
      // Timeout after 5 seconds
      setTimeout(() => {
        webContents.removeListener('dom-ready', handler)
        resolve({ success: false, error: 'Timeout waiting for dom-ready' })
      }, 5000)
    })
  })
  
  ipcMain.handle('webview:wait-for-did-finish-load', async () => {
    if (!agentWebContentsId) {
      return { success: false, error: 'No webview registered' }
    }
    
    return new Promise((resolve) => {
      const webContents = require('electron').webContents.fromId(agentWebContentsId!)
      if (!webContents) {
        resolve({ success: false, error: 'WebContents not found' })
        return
      }
      
      // Check if already loaded
      if (webContents.isLoading() === false) {
        resolve({ success: true })
        return
      }
      
      // Wait for did-finish-load event
      const handler = () => {
        webContents.removeListener('did-finish-load', handler)
        resolve({ success: true })
      }
      webContents.once('did-finish-load', handler)
      
      // Timeout after 10 seconds
      setTimeout(() => {
        webContents.removeListener('did-finish-load', handler)
        resolve({ success: false, error: 'Timeout waiting for did-finish-load' })
      }, 10000)
    })
  })
  
  ipcMain.handle('webview:wait-for-did-stop-loading', async () => {
    if (!agentWebContentsId) {
      return { success: false, error: 'No webview registered' }
    }
    
    return new Promise((resolve) => {
      const webContents = require('electron').webContents.fromId(agentWebContentsId!)
      if (!webContents) {
        resolve({ success: false, error: 'WebContents not found' })
        return
      }
      
      // Check if already stopped loading
      if (webContents.isLoading() === false) {
        resolve({ success: true })
        return
      }
      
      // Wait for did-stop-loading event
      const handler = () => {
        webContents.removeListener('did-stop-loading', handler)
        resolve({ success: true })
      }
      webContents.once('did-stop-loading', handler)
      
      // Timeout after 10 seconds
      setTimeout(() => {
        webContents.removeListener('did-stop-loading', handler)
        resolve({ success: false, error: 'Timeout waiting for did-stop-loading' })
      }, 10000)
    })
  })
  
  // Wait for document ready state via CDP
  ipcMain.handle('webview:wait-for-ready-state', async (_event, targetState: string = 'complete', timeoutMs: number = 10000) => {
    if (!agentWebContentsId) {
      return { success: false, error: 'No webview registered' }
    }
    
    try {
      const webContents = require('electron').webContents.fromId(agentWebContentsId)
      if (!webContents || !webContents.debugger.isAttached()) {
        return { success: false, error: 'Debugger not attached' }
      }
      
      const startTime = Date.now()
      
      // Poll document.readyState via CDP
      while (Date.now() - startTime < timeoutMs) {
        try {
          const result = await webContents.debugger.sendCommand('Runtime.evaluate', {
            expression: 'document.readyState',
            returnByValue: true
          })
          
          const readyState = result.result?.value
          if (readyState === targetState) {
            return { success: true, readyState }
          }
          
          // Wait a bit before checking again
          await new Promise(resolve => setTimeout(resolve, 50))
        } catch (err) {
          // Page might be navigating, continue polling
          await new Promise(resolve => setTimeout(resolve, 100))
        }
      }
      
      return { success: false, error: `Timeout waiting for readyState "${targetState}"` }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })
  
  // Wait for network idle via Performance API
  ipcMain.handle('webview:wait-for-network-idle', async (_event, timeoutMs: number = 10000, idleTimeMs: number = 500) => {
    if (!agentWebContentsId) {
      return { success: false, error: 'No webview registered' }
    }
    
    try {
      const webContents = require('electron').webContents.fromId(agentWebContentsId)
      if (!webContents || !webContents.debugger.isAttached()) {
        return { success: false, error: 'Debugger not attached' }
      }
      
      const startTime = Date.now()
      let lastPendingCount = Infinity
      let idleStartTime = Date.now()
      
      // Ad/tracking patterns to filter out (same as backend)
      const adPatterns = [
        'doubleclick.net', 'googlesyndication.com', 'googletagmanager.com',
        'google-analytics.com', 'facebook.net', 'analytics', 'ads', 'tracking',
        'pixel', 'hotjar.com', 'clarity.ms', 'mixpanel.com', 'segment.com'
      ]
      
      while (Date.now() - startTime < timeoutMs) {
        try {
          const result = await webContents.debugger.sendCommand('Runtime.evaluate', {
            expression: `
              (function() {
                const perf = performance;
                const resources = perf.getEntriesByType('resource');
                const now = perf.now();
                const pending = [];
                
                for (const entry of resources) {
                  if (entry.responseEnd === 0) {
                    const url = entry.name;
                    const isAd = ${JSON.stringify(adPatterns)}.some(pattern => url.includes(pattern));
                    if (isAd) continue;
                    if (url.startsWith('data:') || url.length > 500) continue;
                    
                    const loadingDuration = now - entry.startTime;
                    if (loadingDuration > 10000) continue;
                    
                    const resourceType = entry.initiatorType || 'unknown';
                    const nonCriticalTypes = ['img', 'image', 'icon', 'font'];
                    if (nonCriticalTypes.includes(resourceType) && loadingDuration > 3000) continue;
                    
                    const isImageUrl = /\\.(jpg|jpeg|png|gif|webp|svg|ico)(\\?|$)/i.test(url);
                    if (isImageUrl && loadingDuration > 3000) continue;
                    
                    pending.push(url);
                  }
                }
                
                return pending.length;
              })()
            `,
            returnByValue: true
          })
          
          const pendingCount = result.result?.value || 0
          
          if (pendingCount === 0) {
            // Network is idle
            const idleDuration = Date.now() - idleStartTime
            if (idleDuration >= idleTimeMs) {
              return { success: true, pendingRequests: 0 }
            }
          } else {
            // Reset idle timer if requests are pending
            idleStartTime = Date.now()
          }
          
          lastPendingCount = pendingCount
          await new Promise(resolve => setTimeout(resolve, 100))
        } catch (err) {
          // Page might be navigating, continue polling
          await new Promise(resolve => setTimeout(resolve, 100))
        }
      }
      
      return { success: false, error: 'Timeout waiting for network idle', pendingRequests: lastPendingCount }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })
  
  // Wait for element to be ready (visible and interactive)
  ipcMain.handle('webview:wait-for-element', async (_event, selector: string, timeoutMs: number = 5000) => {
    if (!agentWebContentsId) {
      return { success: false, error: 'No webview registered' }
    }
    
    try {
      const webContents = require('electron').webContents.fromId(agentWebContentsId)
      if (!webContents || !webContents.debugger.isAttached()) {
        return { success: false, error: 'Debugger not attached' }
      }
      
      const startTime = Date.now()
      
      while (Date.now() - startTime < timeoutMs) {
        try {
          const result = await webContents.debugger.sendCommand('Runtime.evaluate', {
            expression: `
              (function() {
                const selector = ${JSON.stringify(selector)};
                let element = null;
                
                // Check if it's a ref-based selector
                if (selector.match(/^e\\d+$/)) {
                  if (window.__ariaRefs && window.__ariaRefs[selector]) {
                    element = window.__ariaRefs[selector];
                  }
                } else if (selector.startsWith('text=')) {
                  const searchText = selector.slice(5).trim().toLowerCase();
                  const allElements = document.querySelectorAll('*');
                  for (const el of allElements) {
                    const text = (el.textContent || '').trim().toLowerCase();
                    if (text === searchText || text.includes(searchText)) {
                      element = el;
                      break;
                    }
                  }
                } else {
                  element = document.querySelector(selector);
                }
                
                if (!element) return { found: false };
                
                const rect = element.getBoundingClientRect();
                const style = window.getComputedStyle(element);
                const isVisible = rect.width > 0 && rect.height > 0 &&
                                 style.display !== 'none' &&
                                 style.visibility !== 'hidden' &&
                                 parseFloat(style.opacity) > 0;
                
                return { found: true, visible: isVisible };
              })()
            `,
            returnByValue: true
          })
          
          const checkResult = result.result?.value
          if (checkResult?.found && checkResult?.visible) {
            return { success: true }
          }
          
          await new Promise(resolve => setTimeout(resolve, 100))
        } catch (err) {
          await new Promise(resolve => setTimeout(resolve, 100))
        }
      }
      
      return { success: false, error: `Timeout waiting for element: ${selector}` }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })
  
  // Get the CDP endpoint for the webview so Playwright can connect to it
  ipcMain.handle('webview:get-cdp-url', async () => {
    if (!agentWebContentsId) {
      return { success: false, error: 'No webview registered' }
    }
    
    try {
      const webContents = require('electron').webContents.fromId(agentWebContentsId)
      if (!webContents) {
        return { success: false, error: 'WebContents not found' }
      }
      
      // Attach debugger to get CDP access
      webContents.debugger.attach('1.3')
      
      // The debugger is now attached - Playwright can connect via the app's remote debugging port
      // Return info about how to connect
      return { 
        success: true, 
        webContentsId: agentWebContentsId,
        message: 'Debugger attached. Backend can control this webview.'
      }
    } catch (err) {
      safeLog('Failed to attach debugger:', err)
      return { success: false, error: String(err) }
    }
  })

  // Execute CDP command on the webview
  ipcMain.handle('webview:cdp-command', async (_event, method: string, params: Record<string, unknown>) => {
    if (!agentWebContentsId) {
      return { success: false, error: 'No webview registered' }
    }
    
    try {
      const webContents = require('electron').webContents.fromId(agentWebContentsId)
      if (!webContents || !webContents.debugger.isAttached()) {
        return { success: false, error: 'Debugger not attached' }
      }
      
      const result = await webContents.debugger.sendCommand(method, params)
      return { success: true, result }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  // Handle webview navigation requests
  ipcMain.handle('webview:navigate', async (_event, url: string) => {
    safeLog('Webview navigate request:', url)
    if (!agentWebContentsId) {
      return { success: false, error: 'No webview registered' }
    }
    
    try {
      const webContents = require('electron').webContents.fromId(agentWebContentsId)
      if (!webContents) {
        return { success: false, error: 'WebContents not found' }
      }
      
      await webContents.loadURL(url)
    return { success: true, url }
    } catch (err) {
      safeLog('Navigation failed:', err)
      return { success: false, error: String(err) }
    }
  })

  // Handle webview action execution (click, type, scroll, press keys)
  ipcMain.handle('webview:execute-action', async (_event, actionType: string, params: Record<string, unknown>) => {
    safeLog('Webview action:', actionType, params)
    if (!agentWebContentsId) {
      return { success: false, error: 'No webview registered' }
    }
    
    try {
      const webContents = require('electron').webContents.fromId(agentWebContentsId)
      if (!webContents) {
        return { success: false, error: 'WebContents not found' }
      }
      
      switch (actionType) {
        case 'click': {
          const selector = params.selector as string
          // Execute click via JavaScript injection with improved selector matching
          // Supports ref-based selectors (e1, e2, etc.) from ARIA snapshots
          const result = await webContents.executeJavaScript(`
            (function() {
              const selector = ${JSON.stringify(selector)};
              let element = null;
              let candidates = [];
              let errorDetails = '';
              
              // Priority 0: Check if it's a ref-based selector (e1, e2, etc.)
              if (selector.match(/^e\\d+$/)) {
                if (window.__ariaRefs && window.__ariaRefs[selector]) {
                  element = window.__ariaRefs[selector];
                } else {
                  return { success: false, error: 'Ref "' + selector + '" not found. Call getAriaSnapshot first to generate refs.' };
                }
              }
              // Try text= selector with improved matching
              else if (selector.startsWith('text=')) {
                const searchText = selector.slice(5).trim();
                const searchTextLower = searchText.toLowerCase();
                const allElements = document.querySelectorAll('*');
                
                // Priority 1: Exact match on clickable elements first
                const clickableSelectors = ['a', 'button', '[role="button"]', '[role="link"]', '[onclick]', 'input[type="button"]', 'input[type="submit"]'];
                for (const clickableSelector of clickableSelectors) {
                  const clickableElements = document.querySelectorAll(clickableSelector);
                  for (const el of clickableElements) {
                    const text = el.textContent ? el.textContent.trim() : '';
                    const textLower = text.toLowerCase();
                    if (text === searchText || textLower === searchTextLower) {
                      element = el;
                      break;
                    }
                    if (textLower.includes(searchTextLower) || searchTextLower.includes(textLower)) {
                      candidates.push({ element: el, text: text, match: 'partial' });
                    }
                  }
                  if (element) break;
                }
                
                // Priority 2: Partial match on clickable elements
                if (!element && candidates.length > 0) {
                  // Prefer shorter text matches (more specific)
                  candidates.sort((a, b) => a.text.length - b.text.length);
                  element = candidates[0].element;
                }
                
                // Priority 3: Exact match on any element
                if (!element) {
                  for (const el of allElements) {
                    const text = el.textContent ? el.textContent.trim() : '';
                    if (text === searchText || text.toLowerCase() === searchTextLower) {
                      element = el;
                      break;
                    }
                  }
                }
                
                // Priority 4: Partial match on any element
                if (!element) {
                  for (const el of allElements) {
                    const text = el.textContent ? el.textContent.trim() : '';
                    if (text.toLowerCase().includes(searchTextLower)) {
                      candidates.push({ element: el, text: text, match: 'contains' });
                    }
                  }
                  if (candidates.length > 0) {
                    candidates.sort((a, b) => a.text.length - b.text.length);
                    element = candidates[0].element;
                  }
                }
                
                // Build error message with suggestions
                if (!element && candidates.length > 0) {
                  const suggestions = candidates.slice(0, 5).map(c => c.text).join(', ');
                  errorDetails = 'Element with exact text "' + searchText + '" not found. Similar elements found: ' + suggestions;
                } else if (!element) {
                  // Find elements with similar text
                  const similarElements = [];
                  for (const el of allElements) {
                    const text = el.textContent ? el.textContent.trim() : '';
                    if (text.length > 0 && text.length < 50) {
                      const similarity = searchTextLower.split('').filter(c => text.toLowerCase().includes(c)).length / searchText.length;
                      if (similarity > 0.3) {
                        similarElements.push({ element: el, text: text, similarity: similarity });
                      }
                    }
                  }
                  similarElements.sort((a, b) => b.similarity - a.similarity);
                  if (similarElements.length > 0) {
                    const suggestions = similarElements.slice(0, 5).map(e => e.text).join(', ');
                    errorDetails = 'Element with text "' + searchText + '" not found. Similar elements: ' + suggestions;
                  } else {
                    errorDetails = 'Element with text "' + searchText + '" not found. No similar elements found.';
                  }
                }
              } else {
                // Try CSS selector
                try {
                  element = document.querySelector(selector);
                  if (!element) {
                    // Try common variations
                    const variations = [
                      selector.toLowerCase(),
                      selector.toUpperCase(),
                      selector.replace(/\\s+/g, ''),
                      '[' + selector + ']',
                      selector + ':first-of-type',
                      selector + ':first-child'
                    ];
                    for (const variant of variations) {
                      element = document.querySelector(variant);
                      if (element) break;
                    }
                  }
                  if (!element) {
                    errorDetails = 'CSS selector "' + selector + '" not found.';
                  }
                } catch (e) {
                  errorDetails = 'Invalid CSS selector "' + selector + '": ' + e.message;
                }
              }
              
              if (element) {
                // Check if element is visible and clickable
                const rect = element.getBoundingClientRect();
                const style = window.getComputedStyle(element);
                if (rect.width === 0 || rect.height === 0) {
                  return { success: false, error: 'Element found but has zero size (not visible)' };
                }
                if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
                  return { success: false, error: 'Element found but is hidden' };
                }
                
                element.scrollIntoView({ block: 'center', behavior: 'smooth' });
                element.click();
                return { success: true, clicked: selector, elementText: element.textContent ? element.textContent.trim().substring(0, 50) : '' };
              }
              
              return { success: false, error: errorDetails || ('Element not found: ' + selector) };
            })()
          `)
          return result
        }
        
        case 'type': {
          const selector = params.selector as string
          const text = params.text as string
          // Focus element and type text with improved selector matching
          // Supports ref-based selectors (e1, e2, etc.) from ARIA snapshots
          const result = await webContents.executeJavaScript(`
            (function() {
              const selector = ${JSON.stringify(selector)};
              const text = ${JSON.stringify(text)};
              let element = null;
              let errorDetails = '';
              
              // Priority 0: Check if it's a ref-based selector (e1, e2, etc.)
              if (selector.match(/^e\\d+$/)) {
                if (window.__ariaRefs && window.__ariaRefs[selector]) {
                  element = window.__ariaRefs[selector];
                } else {
                  return { success: false, error: 'Ref "' + selector + '" not found. Call getAriaSnapshot first to generate refs.' };
                }
              }
              // Try different selector strategies
              else {
                try {
                // Strategy 1: Direct CSS selector
                element = document.querySelector(selector);
                
                // Strategy 2: Try common input selectors
                if (!element && selector.includes('name=')) {
                  const nameMatch = selector.match(/name=["']([^"']+)["']/);
                  if (nameMatch) {
                    element = document.querySelector('input[name="' + nameMatch[1] + '"]') ||
                             document.querySelector('textarea[name="' + nameMatch[1] + '"]');
                  }
                }
                
                // Strategy 3: Try aria-label
                if (!element && selector.includes('aria-label=')) {
                  const ariaMatch = selector.match(/aria-label=["']([^"']+)["']/);
                  if (ariaMatch) {
                    element = document.querySelector('[aria-label="' + ariaMatch[1] + '"]');
                  }
                }
                
                // Strategy 4: Try placeholder
                if (!element && selector.includes('placeholder=')) {
                  const placeholderMatch = selector.match(/placeholder=["']([^"']+)["']/);
                  if (placeholderMatch) {
                    element = document.querySelector('[placeholder="' + placeholderMatch[1] + '"]');
                  }
                }
                
                // Strategy 5: Try text= selector for inputs
                if (!element && selector.startsWith('text=')) {
                  const searchText = selector.slice(5).trim().toLowerCase();
                  const inputs = document.querySelectorAll('input, textarea');
                  for (const input of inputs) {
                    const label = input.getAttribute('aria-label') || 
                                 input.getAttribute('placeholder') ||
                                 (input.closest('label') ? input.closest('label').textContent : '');
                    if (label && label.toLowerCase().includes(searchText)) {
                      element = input;
                      break;
                    }
                  }
                }
                
                if (!element) {
                  errorDetails = 'Input element not found with selector: ' + selector + '. Try using name=, aria-label=, or placeholder= attributes.';
                }
                } catch (e) {
                  errorDetails = 'Invalid selector "' + selector + '": ' + e.message;
                }
              }
              
              if (element) {
                // Verify it's an input element
                if (element.tagName !== 'INPUT' && element.tagName !== 'TEXTAREA' && !element.isContentEditable) {
                  return { success: false, error: 'Element found but is not an input field (tag: ' + element.tagName + ')' };
                }
                
                const rect = element.getBoundingClientRect();
                const style = window.getComputedStyle(element);
                if (rect.width === 0 || rect.height === 0) {
                  return { success: false, error: 'Input element found but has zero size (not visible)' };
                }
                if (style.display === 'none' || style.visibility === 'hidden') {
                  return { success: false, error: 'Input element found but is hidden' };
                }
                
                element.scrollIntoView({ block: 'center', behavior: 'smooth' });
                element.focus();
                
                // Clear existing value first
                if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
                  element.value = '';
                } else if (element.isContentEditable) {
                  element.textContent = '';
                }
                
                // Set new value
                if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
                  element.value = text;
                } else if (element.isContentEditable) {
                  element.textContent = text;
                }
                
                // Dispatch events to trigger any listeners
                element.dispatchEvent(new Event('input', { bubbles: true }));
                element.dispatchEvent(new Event('change', { bubbles: true }));
                element.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));
                element.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Enter' }));
                
                return { success: true, typed: text, selector: selector };
              }
              
              return { success: false, error: errorDetails || ('Element not found: ' + selector) };
            })()
          `)
          return result
        }
        
        case 'press': {
          const key = params.key as string
          try {
            // Map common key names to keyCodes
            const keyMap: Record<string, string> = {
              'Enter': 'Enter',
              'Escape': 'Escape',
              'Tab': 'Tab',
              'Backspace': 'Backspace',
              'Delete': 'Delete',
              'ArrowUp': 'ArrowUp',
              'ArrowDown': 'ArrowDown',
              'ArrowLeft': 'ArrowLeft',
              'ArrowRight': 'ArrowRight'
            };
            
            const keyCode = keyMap[key] || key;
            
            // Send key event
            webContents.sendInputEvent({
              type: 'keyDown',
              keyCode: keyCode
            })
            webContents.sendInputEvent({
              type: 'keyUp', 
              keyCode: keyCode
            })
            return { success: true, pressed: key, keyCode: keyCode }
          } catch (err) {
            return { success: false, error: `Failed to press key "${key}": ${String(err)}` }
          }
        }
        
        case 'scroll': {
          const direction = params.direction as string
          try {
            if (direction !== 'down' && direction !== 'up') {
              return { success: false, error: `Invalid scroll direction: "${direction}". Use "down" or "up".` }
            }
            
            const amount = direction === 'down' ? 500 : -500
            const result = await webContents.executeJavaScript(`
              (function() {
                const beforeScroll = window.pageYOffset || document.documentElement.scrollTop;
                window.scrollBy(0, ${amount});
                const afterScroll = window.pageYOffset || document.documentElement.scrollTop;
                return {
                  scrolled: afterScroll !== beforeScroll,
                  scrollPosition: afterScroll,
                  maxScroll: document.documentElement.scrollHeight - window.innerHeight
                };
              })()
            `)
            
            if (result && result.scrolled) {
              return { success: true, scrolled: direction, position: result.scrollPosition, maxScroll: result.maxScroll }
            } else {
              return { success: false, error: `Cannot scroll ${direction}: already at ${direction === 'down' ? 'bottom' : 'top'} of page` }
            }
          } catch (err) {
            return { success: false, error: `Failed to scroll ${direction}: ${String(err)}` }
          }
        }
        
        default:
          return { success: false, error: 'Unknown action type: ' + actionType }
      }
    } catch (err) {
      safeLog('Action execution failed:', err)
      return { success: false, error: String(err) }
    }
  })

  // Handle webview screenshot requests - returns base64 PNG
  ipcMain.handle('webview:screenshot', async () => {
    safeLog('Webview screenshot request')
    if (!agentWebContentsId) {
      return { success: false, error: 'No webview registered' }
    }
    
    try {
      const webContents = require('electron').webContents.fromId(agentWebContentsId)
      if (!webContents) {
        return { success: false, error: 'WebContents not found' }
      }
      
      const image = await webContents.capturePage()
      const base64 = image.toPNG().toString('base64')
      return { success: true, screenshot: base64 }
    } catch (err) {
      safeLog('Screenshot failed:', err)
      return { success: false, error: String(err) }
    }
  })
  
  // Get page content (accessibility tree or text) for LLM analysis
  ipcMain.handle('webview:get-page-content', async () => {
    if (!agentWebContentsId) {
      return { success: false, error: 'No webview registered' }
    }
    
    try {
      const webContents = require('electron').webContents.fromId(agentWebContentsId)
      if (!webContents) {
        return { success: false, error: 'WebContents not found' }
      }
      
      const content = await webContents.executeJavaScript(`
        (function() {
          // Get interactive elements that the agent might interact with
          const interactiveSelector = 'a, button, input, select, textarea, [role="button"], [role="link"], [onclick]';
          const elements = document.querySelectorAll(interactiveSelector);
          const items = [];
          
          elements.forEach((el, idx) => {
            const rect = el.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              items.push({
                tag: el.tagName.toLowerCase(),
                text: (el.textContent || '').trim().slice(0, 100),
                type: el.type || '',
                name: el.name || '',
                placeholder: el.placeholder || '',
                ariaLabel: el.getAttribute('aria-label') || '',
                href: el.href || '',
                value: el.value || ''
              });
            }
          });
          
          return {
            url: window.location.href,
            title: document.title,
            elements: items.slice(0, 50) // Limit to avoid token explosion
          };
        })()
      `)
      return { success: true, content }
    } catch (err) {
      safeLog('Get page content failed:', err)
      return { success: false, error: String(err) }
    }
  })
  
  // Get current URL
  ipcMain.handle('webview:get-url', async () => {
    if (!agentWebContentsId) {
      return { success: false, error: 'No webview registered' }
    }
    
    try {
      const webContents = require('electron').webContents.fromId(agentWebContentsId)
      if (!webContents) {
        return { success: false, error: 'WebContents not found' }
      }
      
      return { success: true, url: webContents.getURL() }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })
  
  // Get ARIA snapshot (accessibility tree) for LLM - OpenCode-style format
  ipcMain.handle('webview:get-aria-snapshot', async () => {
    if (!agentWebContentsId) {
      return { success: false, error: 'No webview registered' }
    }
    
    try {
      const webContents = require('electron').webContents.fromId(agentWebContentsId)
      if (!webContents) {
        return { success: false, error: 'WebContents not found' }
      }
      
      // Generate ARIA tree using JavaScript (simpler than CDP)
      // Performance limits to prevent huge snapshots on image-heavy pages
      const snapshotResult = await webContents.executeJavaScript(`
        (function() {
          // Performance limits
          const MAX_REFS = 150;      // Max interactive elements to track
          const MAX_DEPTH = 12;      // Max DOM traversal depth (increased for Google's nested structure)
          const MAX_OUTPUT_CHARS = 15000;  // Max output size
          
          if (!window.__ariaRefs) {
            window.__ariaRefs = {};
          }
          
          let refCounter = 0;
          let outputLength = 0;
          let reachedLimit = false;
          const refsMap = {};
          
          function getRef() {
            if (refCounter >= MAX_REFS) {
              reachedLimit = true;
              return null;
            }
            return 'e' + (++refCounter);
          }
          
          function isElementVisible(el) {
            if (!el) return false;
            const rect = el.getBoundingClientRect();
            const style = window.getComputedStyle(el);
            return rect.width > 0 && rect.height > 0 &&
                   style.display !== 'none' &&
                   style.visibility !== 'hidden' &&
                   parseFloat(style.opacity) > 0;
          }
          
          function getAriaRole(el) {
            if (!el) return null;
            const role = el.getAttribute('role');
            if (role) return role;
            
            const tag = el.tagName?.toLowerCase();
            const roleMap = {
              'a': 'link',
              'button': 'button',
              'input': el.type === 'button' || el.type === 'submit' ? 'button' : 'textbox',
              'textarea': 'textbox',
              'select': 'combobox',
              'img': 'img',
              'nav': 'navigation',
              'main': 'main',
              'header': 'banner',
              'footer': 'contentinfo',
              'form': 'form',
              'article': 'article',
              'section': 'region'
            };
            return roleMap[tag] || null;
          }
          
          function getAriaName(el) {
            if (!el) return '';
            return el.getAttribute('aria-label') ||
                   el.getAttribute('alt') ||
                   el.getAttribute('title') ||
                   el.getAttribute('placeholder') ||
                   (el.textContent ? el.textContent.trim().substring(0, 80) : '');
          }
          
          // Check if element is important (navigation, search, main content)
          function isImportantElement(el, role) {
            const tag = el.tagName?.toLowerCase();
            // Always include: nav, main, header, search boxes, buttons
            if (['nav', 'main', 'header', 'footer', 'form'].includes(tag)) return true;
            if (['navigation', 'main', 'banner', 'search', 'form'].includes(role)) return true;
            // Include inputs and buttons
            if (['input', 'button', 'textarea', 'select', 'a'].includes(tag)) return true;
            return false;
          }
          
          // Skip non-essential elements to reduce snapshot size
          function shouldSkipElement(el, role, depth) {
            const tag = el.tagName?.toLowerCase();
            // NEVER skip interactive elements - they're always important
            if (['input', 'textarea', 'button', 'select', 'a'].includes(tag)) return false;
            // Skip SVG internals
            if (['svg', 'path', 'g', 'circle', 'rect', 'line', 'polygon', 'defs', 'use'].includes(tag)) return true;
            // Skip script/style elements
            if (['script', 'style', 'noscript', 'meta', 'link'].includes(tag)) return true;
            // Skip images at deep levels (thumbnails)
            if (role === 'img' && depth > 8) return true;
            return false;
          }
          
          function formatNode(el, indent = '', depth = 0) {
            // Check limits
            if (depth > MAX_DEPTH) return '';
            if (reachedLimit || outputLength > MAX_OUTPUT_CHARS) return '';
            if (!el || !isElementVisible(el)) return '';
            
            const tag = el.tagName?.toLowerCase();
            const role = getAriaRole(el);
            const name = getAriaName(el);
            
            // Skip non-essential elements for performance
            if (shouldSkipElement(el, role, depth)) return '';
            
            const isInteractive = ['a', 'button', 'input', 'select', 'textarea'].includes(tag) ||
                                 el.getAttribute('onclick') ||
                                 el.getAttribute('tabindex') !== null ||
                                 el.getAttribute('role') === 'button' ||
                                 el.getAttribute('role') === 'link';
            
            // For non-interactive, non-role elements, just recurse to find interactive children
            if (!role && !name && !isInteractive) {
              // Get children including Shadow DOM
              let childElements = Array.from(el.children);
              if (el.shadowRoot) {
                childElements = childElements.concat(Array.from(el.shadowRoot.children));
              }
              
              // Process all children and collect their output
              const childOutputs = [];
              for (const child of childElements) {
                if (reachedLimit) break;
                const childStr = formatNode(child, indent, depth + 1);
                if (childStr) {
                  childOutputs.push(childStr);
                }
              }
              // Return children directly (skip this wrapper element)
              return childOutputs.join('\\n');
            }
            
            const lines = [];
            let ref = null;
            
            // Only assign refs to interactive elements
            if (isInteractive) {
              ref = getRef();
              if (ref) refsMap[ref] = el;
            }
            
            let key = role || 'generic';
            if (name) {
              // Truncate long names
              const truncatedName = name.length > 60 ? name.substring(0, 57) + '...' : name;
              key += ' ' + JSON.stringify(truncatedName);
            }
            
            if (el.checked === true) key += ' [checked]';
            if (el.disabled) key += ' [disabled]';
            if (el.expanded !== undefined) key += ' [expanded=' + el.expanded + ']';
            if (el.selected) key += ' [selected]';
            if (ref) key += ' [ref=' + ref + ']';
            
            const props = [];
            if (el.value && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
              props.push('/value: ' + JSON.stringify(el.value));
            }
            if (el.href && el.tagName === 'A') {
              // Truncate long URLs
              const href = el.href.length > 80 ? el.href.substring(0, 77) + '...' : el.href;
              props.push('/url: ' + JSON.stringify(href));
            }
            if (el.placeholder && el.tagName === 'INPUT') {
              props.push('/placeholder: ' + JSON.stringify(el.placeholder));
            }
            
            const children = [];
            // Limit children processing when we have many refs already
            const maxChildren = refCounter > 100 ? 5 : 20;
            let childCount = 0;
            
            // Get children including Shadow DOM
            let childElements = Array.from(el.children);
            
            // Also traverse Shadow DOM if present
            if (el.shadowRoot) {
              childElements = childElements.concat(Array.from(el.shadowRoot.children));
            }
            
            for (const child of childElements) {
              if (reachedLimit || childCount >= maxChildren) break;
              const childStr = formatNode(child, indent + '  ', depth + 1);
              if (childStr) {
                children.push(childStr);
                childCount++;
              }
            }
            
            if (props.length === 0 && children.length === 0) {
              lines.push(indent + '- ' + key);
            } else {
              lines.push(indent + '- ' + key + ':');
              for (const prop of props) {
                lines.push(indent + '  - ' + prop);
              }
              for (const child of children) {
                lines.push(child);
              }
            }
            
            const result = lines.join('\\n');
            outputLength += result.length;
            return result;
          }
          
          // Debug: count all interactive elements on the page
          const allLinks = document.querySelectorAll('a');
          const allButtons = document.querySelectorAll('button');
          const allInputs = document.querySelectorAll('input');
          const visibleLinks = Array.from(allLinks).filter(el => {
            const rect = el.getBoundingClientRect();
            const style = window.getComputedStyle(el);
            return rect.width > 0 && rect.height > 0 &&
                   style.display !== 'none' &&
                   style.visibility !== 'hidden' &&
                   parseFloat(style.opacity) > 0;
          });
          console.log('[ARIA DEBUG] Total links:', allLinks.length, 'Visible links:', visibleLinks.length);
          console.log('[ARIA DEBUG] Total buttons:', allButtons.length, 'Total inputs:', allInputs.length);
          
          let snapshot = formatNode(document.body, '', 0);
          
          console.log('[ARIA DEBUG] Snapshot generated, refCount:', Object.keys(refsMap).length);
          
          // Truncate if still too long
          if (snapshot.length > MAX_OUTPUT_CHARS) {
            snapshot = snapshot.substring(0, MAX_OUTPUT_CHARS) + '\\n... (truncated)';
          }
          
          window.__ariaRefs = refsMap;
          
          return {
            snapshot: snapshot || '- generic "Page"',
            refCount: Object.keys(refsMap).length,
            truncated: reachedLimit || snapshot.length >= MAX_OUTPUT_CHARS,
            debug: {
              totalLinks: allLinks.length,
              visibleLinks: visibleLinks.length,
              totalButtons: allButtons.length,
              totalInputs: allInputs.length
            }
          };
        })()
      `)
      
      return { 
        success: true, 
        snapshot: snapshotResult.snapshot,
        refCount: snapshotResult.refCount,
        truncated: snapshotResult.truncated
      }
    } catch (err) {
      safeLog('Get ARIA snapshot failed:', err)
      return { success: false, error: String(err) }
    }
  })

  // Get app info
  ipcMain.handle('app:get-info', () => {
    return {
      version: app.getVersion(),
      name: app.getName(),
      platform: process.platform
    }
  })
}
