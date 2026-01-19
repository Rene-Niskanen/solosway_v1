"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  X, 
  Globe, 
  Loader2, 
  ExternalLink, 
  Maximize2, 
  Minimize2,
  ArrowLeft,
  ArrowRight,
  RotateCw,
  Monitor,
  MousePointer,
  Type,
  Navigation,
  ChevronRight,
  Target,
  CheckCircle2,
  Circle,
  XCircle,
  Lightbulb,
  Link,
  FileText,
  ChevronDown,
  ChevronUp
} from "lucide-react";
import type { AgentSubGoal, AgentFinding, AgentProgress, AgentSynthesizedResult } from '../contexts/PreviewContext';

interface AgentWebViewProps {
  isOpen: boolean;
  url: string;
  onClose: () => void;
  onUrlChange?: (url: string) => void;
  actionHistory?: Array<{ step: number; action: string }>;
  currentAction?: string;
  isLoading?: boolean;
  // Agent intelligence props
  goals?: AgentSubGoal[];
  findings?: AgentFinding[];
  progress?: AgentProgress | null;
  synthesizedResult?: AgentSynthesizedResult | null;
}

// Electron webview element type (extends HTMLElement with webview-specific methods)
interface ElectronWebviewElement extends HTMLElement {
  src: string;
  canGoBack: () => boolean;
  canGoForward: () => boolean;
  goBack: () => void;
  goForward: () => void;
  reload: () => void;
  getWebContentsId: () => number;
  addEventListener(type: 'did-navigate' | 'did-navigate-in-page' | 'page-title-updated' | 'dom-ready' | 'did-start-loading' | 'did-stop-loading', listener: (event: any) => void): void;
  removeEventListener(type: string, listener: (event: any) => void): void;
}

// Helper to check if running in Electron
const isElectron = (): boolean => {
  return typeof window !== 'undefined' && window.api?.isElectron === true;
};

// Action type icons
const getActionIcon = (action: string) => {
  const actionLower = action.toLowerCase();
  if (actionLower.includes('click')) return <MousePointer className="w-3 h-3" />;
  if (actionLower.includes('type') || actionLower.includes('fill')) return <Type className="w-3 h-3" />;
  if (actionLower.includes('navigate') || actionLower.includes('go to')) return <Navigation className="w-3 h-3" />;
  if (actionLower.includes('scroll')) return <ChevronRight className="w-3 h-3 rotate-90" />;
  return <Globe className="w-3 h-3" />;
};

export const AgentWebView: React.FC<AgentWebViewProps> = ({
  isOpen,
  url,
  onClose,
  onUrlChange,
  actionHistory = [],
  currentAction,
  isLoading = false,
  goals = [],
  findings = [],
  progress = null,
  synthesizedResult = null
}) => {
  console.log('🌐 [AGENTWEBVIEW] Component rendering, isOpen:', isOpen, 'url:', url, 'isElectron:', isElectron());
  
  // Agent panel state
  const [showAgentPanel, setShowAgentPanel] = React.useState(true);
  const [expandedSection, setExpandedSection] = React.useState<'goals' | 'findings' | 'result' | null>('goals');
  
  const webviewRef = React.useRef<ElectronWebviewElement | null>(null);
  const [isFullscreen, setIsFullscreen] = React.useState(false);
  // Start with about:blank - backend will navigate via CDP
  const [currentUrl, setCurrentUrl] = React.useState(url || 'about:blank');
  const [pageTitle, setPageTitle] = React.useState('');
  const [canGoBack, setCanGoBack] = React.useState(false);
  const [canGoForward, setCanGoForward] = React.useState(false);
  const [isWebviewLoading, setIsWebviewLoading] = React.useState(false);
  // Track if this is agent-controlled mode (no URL provided initially)
  const isAgentControlled = React.useRef(!url || url === 'about:blank');

  // Normalize URL for comparison (remove trailing slash, handle http/https)
  const normalizeUrl = (u: string) => {
    if (!u) return '';
    try {
      const parsed = new URL(u);
      // Remove trailing slash from pathname
      if (parsed.pathname === '/') {
        return `${parsed.protocol}//${parsed.host}`;
      }
      return `${parsed.protocol}//${parsed.host}${parsed.pathname.replace(/\/$/, '')}`;
    } catch {
      return u.replace(/\/$/, '');
    }
  };

  // Update URL display when prop changes
  // NOTE: Do NOT navigate here - automation service handles navigation via IPC
  // This just updates the URL bar display
  React.useEffect(() => {
    if (url && url !== 'about:blank' && normalizeUrl(url) !== normalizeUrl(currentUrl)) {
      console.log('🌐 [AGENTWEBVIEW] URL prop changed (display only):', currentUrl, '->', url);
      setCurrentUrl(url);
      // Don't set webviewRef.current.src - automation service navigates via IPC
    }
  }, [url]);

  // Register webview with main process for CDP control
  React.useEffect(() => {
    const webview = webviewRef.current;
    if (!webview || !isElectron()) return;

    const handleDomReady = async () => {
      // Get the webContentsId from the webview
      const webContentsId = webview.getWebContentsId();
      console.log('Webview DOM ready, webContentsId:', webContentsId);
      
      // Register with main process
      try {
        const result = await window.api?.webview.register(webContentsId);
        console.log('Webview registered:', result);
        
        // Enable CDP access
        const cdpResult = await window.api?.webview.getCdpUrl();
        console.log('CDP enabled:', cdpResult);
      } catch (err) {
        console.error('Failed to register webview:', err);
      }
    };

    webview.addEventListener('dom-ready', handleDomReady);
    
    return () => {
      webview.removeEventListener('dom-ready', handleDomReady);
    };
  }, []);

  // Setup webview event listeners
  React.useEffect(() => {
    const webview = webviewRef.current;
    if (!webview) return;

    const handleDidNavigate = (event: { url: string }) => {
      setCurrentUrl(event.url);
      onUrlChange?.(event.url);
      setCanGoBack(webview.canGoBack());
      setCanGoForward(webview.canGoForward());
    };

    const handleDidNavigateInPage = (event: { url: string }) => {
      setCurrentUrl(event.url);
      onUrlChange?.(event.url);
    };

    const handlePageTitleUpdated = (event: { title: string }) => {
      setPageTitle(event.title);
    };

    const handleDidStartLoading = () => {
      setIsWebviewLoading(true);
    };

    const handleDidStopLoading = () => {
      setIsWebviewLoading(false);
      setCanGoBack(webview.canGoBack());
      setCanGoForward(webview.canGoForward());
    };

    // Add event listeners
    webview.addEventListener('did-navigate', handleDidNavigate);
    webview.addEventListener('did-navigate-in-page', handleDidNavigateInPage);
    webview.addEventListener('page-title-updated', handlePageTitleUpdated);
    webview.addEventListener('did-start-loading', handleDidStartLoading);
    webview.addEventListener('did-stop-loading', handleDidStopLoading);

    return () => {
      webview.removeEventListener('did-navigate', handleDidNavigate);
      webview.removeEventListener('did-navigate-in-page', handleDidNavigateInPage);
      webview.removeEventListener('page-title-updated', handlePageTitleUpdated);
      webview.removeEventListener('did-start-loading', handleDidStartLoading);
      webview.removeEventListener('did-stop-loading', handleDidStopLoading);
    };
  }, [onUrlChange]);

  // Navigation methods
  const goBack = () => {
    if (webviewRef.current?.canGoBack()) {
      webviewRef.current.goBack();
    }
  };

  const goForward = () => {
    if (webviewRef.current?.canGoForward()) {
      webviewRef.current.goForward();
    }
  };

  const reload = () => {
    webviewRef.current?.reload();
  };

  const navigateTo = (newUrl: string) => {
    let normalizedUrl = newUrl.trim();
    if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://')) {
      normalizedUrl = 'https://' + normalizedUrl;
    }
    setCurrentUrl(normalizedUrl);
    if (webviewRef.current) {
      webviewRef.current.src = normalizedUrl;
    }
  };

  // Handle URL input submit
  const handleUrlSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    navigateTo(currentUrl);
  };

  if (!isOpen) {
    return null;
  }

  // If not running in Electron, show fallback message
  if (!isElectron()) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="flex-1 bg-gray-50 flex items-center justify-center"
      >
        <div className="text-center p-8 max-w-md">
          <Monitor className="w-16 h-16 mx-auto mb-4 text-gray-300" />
          <h3 className="text-lg font-semibold text-gray-700 mb-2">
            Browser Agent Unavailable
          </h3>
          <p className="text-gray-500 text-sm">
            The embedded browser requires the Velora desktop app. 
            You're currently running in a web browser.
          </p>
          <button
            onClick={onClose}
            className="mt-4 px-4 py-2 bg-gray-200 hover:bg-gray-300 rounded-lg text-sm font-medium transition-colors"
          >
            Close
          </button>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      transition={{ duration: 0.2 }}
      className={`flex flex-col bg-white ${isFullscreen ? 'fixed inset-0 z-[10000]' : 'fixed top-0 bottom-0 right-0 z-40'}`}
      style={isFullscreen ? undefined : { 
        width: '65vw',  // Take up space to the right of chat (which is 35vw)
        borderLeft: '1px solid #e5e7eb'
      }}
    >
      {/* Header */}
      <div className="px-3 py-2 border-b border-gray-200 flex items-center gap-2 bg-gray-50/80">
        {/* Close and Fullscreen buttons */}
        <div className="flex items-center gap-1">
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-gray-200 rounded-md transition-colors"
            title="Close"
          >
            <X className="w-4 h-4 text-gray-600" />
          </button>
          <button
            onClick={() => setIsFullscreen(!isFullscreen)}
            className="p-1.5 hover:bg-gray-200 rounded-md transition-colors"
            title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
          >
            {isFullscreen ? (
              <Minimize2 className="w-4 h-4 text-gray-600" />
            ) : (
              <Maximize2 className="w-4 h-4 text-gray-600" />
            )}
          </button>
        </div>

        {/* Navigation buttons */}
        <div className="flex items-center gap-1 border-l border-gray-200 pl-2">
          <button
            onClick={goBack}
            disabled={!canGoBack}
            className="p-1.5 hover:bg-gray-200 rounded-md transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            title="Go back"
          >
            <ArrowLeft className="w-4 h-4 text-gray-600" />
          </button>
          <button
            onClick={goForward}
            disabled={!canGoForward}
            className="p-1.5 hover:bg-gray-200 rounded-md transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            title="Go forward"
          >
            <ArrowRight className="w-4 h-4 text-gray-600" />
          </button>
          <button
            onClick={reload}
            className="p-1.5 hover:bg-gray-200 rounded-md transition-colors"
            title="Reload"
          >
            <RotateCw className={`w-4 h-4 text-gray-600 ${isWebviewLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* URL bar */}
        <form onSubmit={handleUrlSubmit} className="flex-1 flex items-center">
          <div className="flex-1 flex items-center gap-2 px-3 py-1.5 bg-white rounded-lg border border-gray-200 shadow-inner">
            {isWebviewLoading ? (
              <Loader2 className="w-4 h-4 text-blue-500 animate-spin flex-shrink-0" />
            ) : (
              <Globe className="w-4 h-4 text-gray-400 flex-shrink-0" />
            )}
            <input
              type="text"
              value={currentUrl}
              onChange={(e) => setCurrentUrl(e.target.value)}
              className="flex-1 text-sm text-gray-700 bg-transparent outline-none font-mono"
              placeholder="Enter URL..."
            />
          </div>
        </form>

        {/* Open in browser */}
        <a
          href={currentUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="p-1.5 hover:bg-gray-200 rounded-md transition-colors"
          title="Open in browser"
        >
          <ExternalLink className="w-4 h-4 text-gray-600" />
        </a>
      </div>

      {/* Current Action Banner */}
      <AnimatePresence>
        {(currentAction || isLoading) && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="px-4 py-2 bg-gradient-to-r from-amber-50 to-orange-50 border-b border-amber-200"
          >
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 bg-amber-500 rounded-full animate-pulse" />
              <span className="text-sm font-medium text-amber-700">
                {currentAction || 'Agent is working...'}
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Webview container */}
        <div className="flex-1 relative">
          {/* @ts-ignore - webview is an Electron-specific element */}
          {/* @ts-ignore - webview is an Electron-specific element */}
          <webview
            ref={webviewRef as React.RefObject<HTMLElement>}
            src="about:blank"
            className="absolute inset-0 w-full h-full"
            // @ts-ignore - allowpopups is an Electron webview attribute (must be string for DOM)
            allowpopups="true"
            // Use fresh partition each session to avoid cookie consent issues
            partition="persist:agent-browser"
            // Use Chrome user agent to avoid bot detection
            useragent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
            // Enable JavaScript and web features
            // @ts-ignore
            webpreferences="javascript=yes, webSecurity=yes, allowRunningInsecureContent=no"
          />
        </div>

        {/* Agent Intelligence Panel */}
        {(goals.length > 0 || findings.length > 0 || actionHistory.length > 0 || synthesizedResult) && (
          <div className="w-72 border-l border-gray-200 bg-gray-50 overflow-hidden flex flex-col">
            {/* Progress Bar */}
            {progress && (
              <div className="px-3 py-2 border-b border-gray-200 bg-white">
                <div className="flex items-center justify-between text-xs text-gray-600 mb-1">
                  <span className="font-medium">Progress</span>
                  <span>{progress.completed}/{progress.total} goals</span>
                </div>
                <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-gradient-to-r from-blue-500 to-green-500 transition-all duration-300"
                    style={{ width: `${progress.total > 0 ? (progress.completed / progress.total) * 100 : 0}%` }}
                  />
                </div>
              </div>
            )}

            {/* Synthesized Result (if complete) */}
            {synthesizedResult && (
              <div className="border-b border-gray-200">
                <button
                  onClick={() => setExpandedSection(expandedSection === 'result' ? null : 'result')}
                  className="w-full p-3 flex items-center justify-between bg-green-50 hover:bg-green-100 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-600" />
                    <span className="text-xs font-semibold text-green-700 uppercase tracking-wider">
                      Result
                    </span>
                    <span className="text-xs text-green-600 bg-green-100 px-1.5 py-0.5 rounded">
                      {Math.round(synthesizedResult.confidence * 100)}% confident
                    </span>
                  </div>
                  {expandedSection === 'result' ? <ChevronUp className="w-4 h-4 text-green-600" /> : <ChevronDown className="w-4 h-4 text-green-600" />}
                </button>
                {expandedSection === 'result' && (
                  <div className="p-3 bg-white max-h-48 overflow-y-auto">
                    <p className="text-sm text-gray-700 leading-relaxed">{synthesizedResult.answer}</p>
                    {synthesizedResult.sources.length > 0 && (
                      <div className="mt-2 pt-2 border-t border-gray-100">
                        <p className="text-xs text-gray-500 mb-1">Sources:</p>
                        {synthesizedResult.sources.slice(0, 3).map((src, idx) => (
                          <div key={idx} className="flex items-center gap-1 text-xs text-blue-600 truncate">
                            <Link className="w-3 h-3 flex-shrink-0" />
                            <span className="truncate">{src}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Goals Section */}
            {goals.length > 0 && (
              <div className="border-b border-gray-200">
                <button
                  onClick={() => setExpandedSection(expandedSection === 'goals' ? null : 'goals')}
                  className="w-full p-3 flex items-center justify-between hover:bg-gray-100 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <Target className="w-4 h-4 text-blue-600" />
                    <span className="text-xs font-semibold text-gray-600 uppercase tracking-wider">
                      Goals
                    </span>
                    <span className="text-xs text-gray-500 bg-gray-200 px-1.5 py-0.5 rounded">
                      {goals.filter(g => g.status === 'completed').length}/{goals.length}
                    </span>
                  </div>
                  {expandedSection === 'goals' ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                </button>
                {expandedSection === 'goals' && (
                  <div className="max-h-40 overflow-y-auto">
                    {goals.map((goal, idx) => (
                      <div key={goal.id} className={`px-3 py-2 border-b border-gray-100 ${
                        goal.status === 'in_progress' ? 'bg-blue-50' : ''
                      }`}>
                        <div className="flex items-start gap-2">
                          {goal.status === 'completed' ? (
                            <CheckCircle2 className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                          ) : goal.status === 'in_progress' ? (
                            <div className="w-4 h-4 mt-0.5 flex-shrink-0">
                              <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
                            </div>
                          ) : goal.status === 'failed' ? (
                            <XCircle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
                          ) : (
                            <Circle className="w-4 h-4 text-gray-300 mt-0.5 flex-shrink-0" />
                          )}
                          <div className="flex-1 min-w-0">
                            <p className={`text-xs ${
                              goal.status === 'completed' ? 'text-gray-500 line-through' :
                              goal.status === 'in_progress' ? 'text-blue-700 font-medium' :
                              'text-gray-600'
                            }`}>
                              {idx + 1}. {goal.description}
                            </p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Findings Section */}
            {findings.length > 0 && (
              <div className="border-b border-gray-200">
                <button
                  onClick={() => setExpandedSection(expandedSection === 'findings' ? null : 'findings')}
                  className="w-full p-3 flex items-center justify-between hover:bg-gray-100 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <Lightbulb className="w-4 h-4 text-amber-500" />
                    <span className="text-xs font-semibold text-gray-600 uppercase tracking-wider">
                      Findings
                    </span>
                    <span className="text-xs text-gray-500 bg-gray-200 px-1.5 py-0.5 rounded">
                      {findings.length}
                    </span>
                  </div>
                  {expandedSection === 'findings' ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                </button>
                {expandedSection === 'findings' && (
                  <div className="max-h-40 overflow-y-auto">
                    {findings.map((finding, idx) => (
                      <div key={finding.id} className="px-3 py-2 border-b border-gray-100">
                        <div className="flex items-start gap-2">
                          <FileText className="w-3 h-3 text-amber-500 mt-0.5 flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs text-gray-700">{finding.fact}</p>
                            <div className="flex items-center gap-2 mt-1">
                              <span className="text-xs text-gray-400 truncate max-w-[100px]">
                                {new URL(finding.source_url).hostname}
                              </span>
                              <span className={`text-xs px-1 py-0.5 rounded ${
                                finding.confidence >= 0.8 ? 'bg-green-100 text-green-600' :
                                finding.confidence >= 0.5 ? 'bg-yellow-100 text-yellow-600' :
                                'bg-red-100 text-red-600'
                              }`}>
                                {Math.round(finding.confidence * 100)}%
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Actions Section (existing, moved here) */}
            {actionHistory.length > 0 && (
              <div className="flex-1 flex flex-col overflow-hidden">
                <div className="p-3 border-b border-gray-200 shrink-0 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <MousePointer className="w-4 h-4 text-gray-500" />
                    <h3 className="text-xs font-semibold text-gray-600 uppercase tracking-wider">
                      Actions
                    </h3>
                  </div>
                  <span className="text-xs text-gray-500 bg-gray-200 px-1.5 py-0.5 rounded">
                    {actionHistory.length}
                  </span>
                </div>
                <div className="overflow-y-auto flex-1">
                  {actionHistory.map((item, idx) => (
                    <motion.div
                      key={idx}
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: idx * 0.05 }}
                      className={`p-2 border-b border-gray-100 ${
                        idx === actionHistory.length - 1 
                          ? 'bg-blue-50' 
                          : ''
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        <div className="mt-0.5 p-1 rounded bg-white shadow-sm flex-shrink-0">
                          {getActionIcon(item.action)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-gray-500 line-clamp-2">
                            {item.action}
                          </p>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer Status Bar */}
      <div className="px-4 py-2 border-t border-gray-200 bg-gray-50 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${
            isWebviewLoading || isLoading ? 'bg-amber-500 animate-pulse' : 'bg-green-500'
          }`} />
          <span className="text-xs text-gray-500">
            {isWebviewLoading ? 'Loading...' : pageTitle || 'Ready'}
          </span>
        </div>
        <div className="text-xs text-gray-400">
          {actionHistory.length} actions
        </div>
      </div>
    </motion.div>
  );
};

export default AgentWebView;
