// Electron API type declarations for renderer process

interface PageContent {
  url: string
  title: string
  elements: Array<{
    tag: string
    text: string
    type: string
    name: string
    placeholder: string
    ariaLabel: string
    href: string
    value: string
  }>
}

interface WebviewAPI {
  register: (webContentsId: number) => Promise<{ success: boolean }>
  getCdpUrl: () => Promise<{ success: boolean; webContentsId?: number; error?: string }>
  cdpCommand: (method: string, params: Record<string, unknown>) => Promise<{ success: boolean; result?: unknown; error?: string }>
  navigate: (url: string) => Promise<{ success: boolean; url?: string; error?: string }>
  executeAction: (actionType: string, params: Record<string, unknown>) => Promise<{ success: boolean; error?: string }>
  screenshot: () => Promise<{ success: boolean; screenshot?: string; error?: string }>
  getPageContent: () => Promise<{ success: boolean; content?: PageContent; error?: string }>
  getUrl: () => Promise<{ success: boolean; url?: string; error?: string }>
  getAriaSnapshot: () => Promise<{ success: boolean; snapshot?: string; refCount?: number; truncated?: boolean; error?: string }>
  // Event-based waiting methods
  onDomReady: () => Promise<{ success: boolean; error?: string }>
  onDidFinishLoad: () => Promise<{ success: boolean; error?: string }>
  onDidStopLoading: () => Promise<{ success: boolean; error?: string }>
  waitForDocumentReady: (targetState?: string, timeoutMs?: number) => Promise<{ success: boolean; readyState?: string; error?: string }>
  waitForNetworkIdle: (timeoutMs?: number, idleTimeMs?: number) => Promise<{ success: boolean; pendingRequests?: number; error?: string }>
  waitForElementReady: (selector: string, timeoutMs?: number) => Promise<{ success: boolean; error?: string }>
}

interface AppAPI {
  getInfo: () => Promise<{ version: string; name: string; platform: string }>
}

interface ElectronAPI {
  webview: WebviewAPI
  app: AppAPI
  isElectron: boolean
}

declare global {
  interface Window {
    api?: ElectronAPI
    electron?: {
      ipcRenderer: {
        send: (channel: string, ...args: unknown[]) => void
        on: (channel: string, listener: (...args: unknown[]) => void) => void
        once: (channel: string, listener: (...args: unknown[]) => void) => void
        removeListener: (channel: string, listener: (...args: unknown[]) => void) => void
      }
    }
  }
}

export {}
