/**
 * WebView Controller Service
 * 
 * Provides methods to control the embedded webview for browser automation.
 * Works with the Electron main process via IPC.
 */

// Check if running in Electron
export const isElectron = (): boolean => {
  return typeof window !== 'undefined' && window.api?.isElectron === true;
};

// Type for webview reference
type WebviewElement = Electron.WebviewTag;

// Controller state
let webviewRef: WebviewElement | null = null;
let isAgentActive = false;

/**
 * Set the webview reference for control
 */
export const setWebviewRef = (ref: WebviewElement | null): void => {
  webviewRef = ref;
};

/**
 * Get the current webview reference
 */
export const getWebviewRef = (): WebviewElement | null => {
  return webviewRef;
};

/**
 * Navigate the webview to a URL
 */
export const navigate = async (url: string): Promise<{ success: boolean; error?: string }> => {
  if (!webviewRef) {
    return { success: false, error: 'Webview not initialized' };
  }

  try {
    // Normalize URL
    let normalizedUrl = url.trim();
    if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://')) {
      normalizedUrl = 'https://' + normalizedUrl;
    }

    webviewRef.src = normalizedUrl;
    
    // Wait for navigation to complete
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Navigation timeout'));
      }, 30000);

      const handleLoad = () => {
        clearTimeout(timeout);
        webviewRef?.removeEventListener('did-finish-load', handleLoad);
        webviewRef?.removeEventListener('did-fail-load', handleError);
        resolve();
      };

      const handleError = (event: Electron.DidFailLoadEvent) => {
        clearTimeout(timeout);
        webviewRef?.removeEventListener('did-finish-load', handleLoad);
        webviewRef?.removeEventListener('did-fail-load', handleError);
        reject(new Error(`Navigation failed: ${event.errorDescription}`));
      };

      webviewRef.addEventListener('did-finish-load', handleLoad);
      webviewRef.addEventListener('did-fail-load', handleError);
    });

    return { success: true };
  } catch (error) {
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    };
  }
};

/**
 * Click on an element in the webview
 */
export const click = async (selector: string): Promise<{ success: boolean; error?: string }> => {
  if (!webviewRef) {
    return { success: false, error: 'Webview not initialized' };
  }

  try {
    await webviewRef.executeJavaScript(`
      (function() {
        const element = document.querySelector('${selector.replace(/'/g, "\\'")}');
        if (element) {
          element.click();
          return true;
        }
        throw new Error('Element not found: ${selector}');
      })()
    `);
    return { success: true };
  } catch (error) {
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Click failed' 
    };
  }
};

/**
 * Type text into an element in the webview
 */
export const type = async (
  selector: string, 
  text: string,
  options?: { submit?: boolean }
): Promise<{ success: boolean; error?: string }> => {
  if (!webviewRef) {
    return { success: false, error: 'Webview not initialized' };
  }

  try {
    const escapedText = text.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
    
    await webviewRef.executeJavaScript(`
      (function() {
        const element = document.querySelector('${selector.replace(/'/g, "\\'")}');
        if (element) {
          element.focus();
          element.value = '${escapedText}';
          element.dispatchEvent(new Event('input', { bubbles: true }));
          element.dispatchEvent(new Event('change', { bubbles: true }));
          ${options?.submit ? `
            const form = element.closest('form');
            if (form) {
              form.submit();
            } else {
              element.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', bubbles: true }));
            }
          ` : ''}
          return true;
        }
        throw new Error('Element not found: ${selector}');
      })()
    `);
    return { success: true };
  } catch (error) {
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Type failed' 
    };
  }
};

/**
 * Scroll the webview
 */
export const scroll = async (
  direction: 'up' | 'down' | 'left' | 'right',
  amount: number = 500
): Promise<{ success: boolean; error?: string }> => {
  if (!webviewRef) {
    return { success: false, error: 'Webview not initialized' };
  }

  try {
    const scrollMap = {
      up: `window.scrollBy(0, -${amount})`,
      down: `window.scrollBy(0, ${amount})`,
      left: `window.scrollBy(-${amount}, 0)`,
      right: `window.scrollBy(${amount}, 0)`
    };

    await webviewRef.executeJavaScript(scrollMap[direction]);
    return { success: true };
  } catch (error) {
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Scroll failed' 
    };
  }
};

/**
 * Get the current URL of the webview
 */
export const getCurrentUrl = (): string | null => {
  return webviewRef?.getURL() || null;
};

/**
 * Get the page title of the webview
 */
export const getPageTitle = (): string | null => {
  return webviewRef?.getTitle() || null;
};

/**
 * Take a screenshot of the webview
 */
export const screenshot = async (): Promise<{ success: boolean; data?: string; error?: string }> => {
  if (!webviewRef) {
    return { success: false, error: 'Webview not initialized' };
  }

  try {
    const image = await webviewRef.capturePage();
    const dataUrl = image.toDataURL();
    // Extract base64 data without the prefix
    const base64Data = dataUrl.replace(/^data:image\/png;base64,/, '');
    return { success: true, data: base64Data };
  } catch (error) {
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Screenshot failed' 
    };
  }
};

/**
 * Get the ARIA snapshot of the page for AI agent
 */
export const getAISnapshot = async (): Promise<{ success: boolean; snapshot?: string; error?: string }> => {
  if (!webviewRef) {
    return { success: false, error: 'Webview not initialized' };
  }

  try {
    // Get a simplified accessibility tree
    const snapshot = await webviewRef.executeJavaScript(`
      (function() {
        function getAriaTree(element, depth = 0, refs = { counter: 0 }) {
          if (depth > 10) return '';
          
          const tag = element.tagName?.toLowerCase();
          if (!tag || ['script', 'style', 'noscript', 'svg', 'path'].includes(tag)) return '';
          
          const role = element.getAttribute('role') || getImplicitRole(tag);
          const label = element.getAttribute('aria-label') || 
                        element.getAttribute('alt') || 
                        element.getAttribute('title') ||
                        element.getAttribute('placeholder') ||
                        (element.innerText?.trim().substring(0, 50));
          
          const isInteractive = ['a', 'button', 'input', 'select', 'textarea'].includes(tag) ||
                               element.getAttribute('onclick') ||
                               element.getAttribute('tabindex');
          
          if (!label && !isInteractive && element.children.length === 0) return '';
          
          let result = '';
          const indent = '  '.repeat(depth);
          
          if (isInteractive || role) {
            refs.counter++;
            const ref = 'e' + refs.counter;
            element.setAttribute('data-ai-ref', ref);
            
            let line = indent + '- ' + (role || tag);
            if (label) line += ' "' + label.replace(/"/g, "'") + '"';
            line += ' [ref=' + ref + ']';
            
            if (element.href) line += ' [href=' + element.href + ']';
            if (element.type) line += ' [type=' + element.type + ']';
            
            result += line + '\\n';
          }
          
          for (const child of element.children) {
            result += getAriaTree(child, depth + 1, refs);
          }
          
          return result;
        }
        
        function getImplicitRole(tag) {
          const roles = {
            a: 'link', button: 'button', input: 'textbox',
            select: 'combobox', textarea: 'textbox', img: 'img',
            nav: 'navigation', main: 'main', header: 'banner',
            footer: 'contentinfo', form: 'form', article: 'article'
          };
          return roles[tag] || '';
        }
        
        return getAriaTree(document.body);
      })()
    `);

    return { success: true, snapshot };
  } catch (error) {
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Snapshot failed' 
    };
  }
};

/**
 * Click an element by its AI ref
 */
export const clickByRef = async (ref: string): Promise<{ success: boolean; error?: string }> => {
  if (!webviewRef) {
    return { success: false, error: 'Webview not initialized' };
  }

  try {
    await webviewRef.executeJavaScript(`
      (function() {
        const element = document.querySelector('[data-ai-ref="${ref}"]');
        if (element) {
          element.click();
          return true;
        }
        throw new Error('Element not found: ${ref}');
      })()
    `);
    return { success: true };
  } catch (error) {
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Click failed' 
    };
  }
};

/**
 * Type into an element by its AI ref
 */
export const typeByRef = async (
  ref: string, 
  text: string,
  options?: { submit?: boolean }
): Promise<{ success: boolean; error?: string }> => {
  if (!webviewRef) {
    return { success: false, error: 'Webview not initialized' };
  }

  try {
    const escapedText = text.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
    
    await webviewRef.executeJavaScript(`
      (function() {
        const element = document.querySelector('[data-ai-ref="${ref}"]');
        if (element) {
          element.focus();
          if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
            element.value = '${escapedText}';
          } else {
            element.innerText = '${escapedText}';
          }
          element.dispatchEvent(new Event('input', { bubbles: true }));
          element.dispatchEvent(new Event('change', { bubbles: true }));
          ${options?.submit ? `
            const form = element.closest('form');
            if (form) {
              form.submit();
            } else {
              element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
            }
          ` : ''}
          return true;
        }
        throw new Error('Element not found: ${ref}');
      })()
    `);
    return { success: true };
  } catch (error) {
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Type failed' 
    };
  }
};

/**
 * Set agent active state
 */
export const setAgentActive = (active: boolean): void => {
  isAgentActive = active;
};

/**
 * Get agent active state
 */
export const getAgentActive = (): boolean => {
  return isAgentActive;
};

// Export controller object
export const webviewController = {
  isElectron,
  setWebviewRef,
  getWebviewRef,
  navigate,
  click,
  type,
  scroll,
  getCurrentUrl,
  getPageTitle,
  screenshot,
  getAISnapshot,
  clickByRef,
  typeByRef,
  setAgentActive,
  getAgentActive
};

export default webviewController;
