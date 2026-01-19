import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Custom APIs for renderer
const api = {
  // Webview control methods for browser automation
  webview: {
    // Register webview with main process so it can be controlled
    register: (webContentsId: number): Promise<{ success: boolean }> => {
      return ipcRenderer.invoke('webview:register', webContentsId)
    },
    // Get CDP URL so backend can connect to this webview
    getCdpUrl: (): Promise<{ success: boolean; webContentsId?: number; error?: string }> => {
      return ipcRenderer.invoke('webview:get-cdp-url')
    },
    // Execute CDP command directly on the webview
    cdpCommand: (method: string, params: Record<string, unknown>): Promise<{ success: boolean; result?: unknown; error?: string }> => {
      return ipcRenderer.invoke('webview:cdp-command', method, params)
    },
    // Navigate webview to URL
    navigate: (url: string): Promise<{ success: boolean; url?: string; error?: string }> => {
      return ipcRenderer.invoke('webview:navigate', url)
    },
    // Execute action on webview (click, type, scroll, press)
    executeAction: (actionType: string, params: Record<string, unknown>): Promise<{ success: boolean; error?: string }> => {
      return ipcRenderer.invoke('webview:execute-action', actionType, params)
    },
    // Take screenshot of webview - returns base64 PNG
    screenshot: (): Promise<{ success: boolean; screenshot?: string; error?: string }> => {
      return ipcRenderer.invoke('webview:screenshot')
    },
    // Get page content (interactive elements) for LLM analysis
    getPageContent: (): Promise<{ success: boolean; content?: { url: string; title: string; elements: unknown[] }; error?: string }> => {
      return ipcRenderer.invoke('webview:get-page-content')
    },
    // Get current URL
    getUrl: (): Promise<{ success: boolean; url?: string; error?: string }> => {
      return ipcRenderer.invoke('webview:get-url')
    },
    // Get ARIA snapshot (accessibility tree) for LLM
    getAriaSnapshot: (): Promise<{ success: boolean; snapshot?: string; refCount?: number; truncated?: boolean; error?: string }> => {
      return ipcRenderer.invoke('webview:get-aria-snapshot')
    },
    // Event-based waiting methods
    onDomReady: (): Promise<{ success: boolean; error?: string }> => {
      return ipcRenderer.invoke('webview:wait-for-dom-ready')
    },
    onDidFinishLoad: (): Promise<{ success: boolean; error?: string }> => {
      return ipcRenderer.invoke('webview:wait-for-did-finish-load')
    },
    onDidStopLoading: (): Promise<{ success: boolean; error?: string }> => {
      return ipcRenderer.invoke('webview:wait-for-did-stop-loading')
    },
    waitForDocumentReady: (targetState?: string, timeoutMs?: number): Promise<{ success: boolean; readyState?: string; error?: string }> => {
      return ipcRenderer.invoke('webview:wait-for-ready-state', targetState, timeoutMs)
    },
    waitForNetworkIdle: (timeoutMs?: number, idleTimeMs?: number): Promise<{ success: boolean; pendingRequests?: number; error?: string }> => {
      return ipcRenderer.invoke('webview:wait-for-network-idle', timeoutMs, idleTimeMs)
    },
    waitForElementReady: (selector: string, timeoutMs?: number): Promise<{ success: boolean; error?: string }> => {
      return ipcRenderer.invoke('webview:wait-for-element', selector, timeoutMs)
    }
  },
  
  // App info
  app: {
    getInfo: (): Promise<{ version: string; name: string; platform: string }> => {
      return ipcRenderer.invoke('app:get-info')
    }
  },

  // Check if running in Electron
  isElectron: true
}

// Use `contextBridge` APIs to expose Electron APIs to renderer
// only if context isolation is enabled
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
