/**
 * Webview Automation Controller
 * 
 * Runs browser automation directly on the Electron webview.
 * The frontend controls the browser, backend provides LLM decisions.
 * 
 * Flow:
 * 1. Navigate webview to starting URL
 * 2. Take screenshot
 * 3. Send screenshot to backend /api/browser/step
 * 4. Execute returned action on webview
 * 5. Repeat until DONE or max steps
 * 
 * Enhanced with Autonomous Intelligence:
 * - Session-based goal tracking
 * - Automatic information extraction
 * - Progress reflection
 * - Synthesized results
 */

import { env } from '@/config/env';
import { 
  agentSessionManager, 
  SubGoal, 
  Finding, 
  ReflectionResult,
  SessionProgress,
  SynthesizedResult 
} from './agentSessionState';

const BACKEND_URL = env.backendUrl;

export interface AutomationAction {
  step: number;
  action: string;
  action_type: string;
  action_data: Record<string, unknown>;
  url?: string;
  url_before?: string;
  url_after?: string;
  success?: boolean;
  error?: string;
}

export interface AutomationResult {
  success: boolean;
  history: AutomationAction[];
  error?: string;
  synthesizedResult?: SynthesizedResult;
}

export interface AutomationCallbacks {
  onStepStart?: (step: number, totalSteps: number) => void;
  onAction?: (action: AutomationAction) => void;
  onUrlChange?: (url: string) => void;
  onComplete?: (reason: string, history: AutomationAction[]) => void;
  onError?: (error: string) => void;
  
  // NEW: Intelligence callbacks
  onPlanCreated?: (goals: SubGoal[]) => void;
  onGoalStarted?: (goal: SubGoal) => void;
  onGoalCompleted?: (goalId: string) => void;
  onFindingExtracted?: (findings: Finding[]) => void;
  onReflection?: (reflection: ReflectionResult) => void;
  onProgressUpdate?: (progress: SessionProgress) => void;
  onSynthesizedResult?: (result: SynthesizedResult) => void;
}

export interface AutomationOptions {
  /** Enable autonomous session mode with goal tracking */
  useSession?: boolean;
  /** Maximum steps before stopping */
  maxSteps?: number;
}

function isElectron(): boolean {
  return typeof window !== 'undefined' && !!window.api?.isElectron;
}

/**
 * Wait for webview to be registered and ready (event-based)
 */
async function waitForWebviewReadyEvent(maxWaitMs: number = 5000): Promise<boolean> {
  const webview = window.api?.webview;
  if (!webview) return false;
  
  try {
    // Use event-based waiting for dom-ready
    const result = await webview.onDomReady();
    if (result.success) {
      console.log('✅ [AUTOMATION] Webview is ready (dom-ready event)');
      return true;
    }
    // Fallback to polling if event times out
    console.log('⚠️ [AUTOMATION] Event wait timed out, falling back to polling');
  } catch {
    // Fallback to polling if event API not available
  }
  
  // Fallback: polling-based check
  const startTime = Date.now();
  while (Date.now() - startTime < maxWaitMs) {
    try {
      const result = await webview.getUrl();
      if (result.success) {
        console.log('✅ [AUTOMATION] Webview is ready (polling fallback)');
        return true;
      }
    } catch {
      // Not ready yet
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  return false;
}

/**
 * Legacy function - now uses event-based approach
 */
async function waitForWebviewReady(maxWaitMs: number = 5000): Promise<boolean> {
  return waitForWebviewReadyEvent(maxWaitMs);
}

/**
 * Wait for page to load using event-based approach
 */
async function waitForPageLoadEvent(
  webview: { 
    getUrl: () => Promise<{ success: boolean; url?: string; error?: string }>;
    onDidFinishLoad?: () => Promise<{ success: boolean; error?: string }>;
    onDidStopLoading?: () => Promise<{ success: boolean; error?: string }>;
  },
  urlBefore: string,
  maxWaitMs: number = 10000
): Promise<void> {
  // First check if URL changed (quick check)
  const urlResult = await webview.getUrl();
  if (urlResult.success && urlResult.url !== urlBefore) {
    console.log(`🌐 [AUTOMATION] Page updated: URL changed to ${urlResult.url}`);
  }
  
  // Wait for page to finish loading using events
  if (webview.onDidStopLoading) {
    try {
      const result = await webview.onDidStopLoading();
      if (result.success) {
        console.log('✅ [AUTOMATION] Page finished loading (did-stop-loading event)');
        return;
      }
    } catch (err) {
      console.log('⚠️ [AUTOMATION] Event wait failed, using fallback:', err);
    }
  }
  
  // Fallback: wait for did-finish-load
  if (webview.onDidFinishLoad) {
    try {
      const result = await webview.onDidFinishLoad();
      if (result.success) {
        console.log('✅ [AUTOMATION] Page finished loading (did-finish-load event)');
        return;
      }
    } catch {
      // Continue to polling fallback
    }
  }
  
  // Fallback: polling-based check (legacy behavior)
  const startTime = Date.now();
  while (Date.now() - startTime < maxWaitMs) {
    try {
      const urlResult = await webview.getUrl();
      if (urlResult.success && urlResult.url !== urlBefore) {
        console.log(`🌐 [AUTOMATION] Page updated: URL changed to ${urlResult.url} (polling fallback)`);
        await new Promise(resolve => setTimeout(resolve, 300));
        return;
      }
    } catch {
      // Ignore errors during polling
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  console.log('⏱️ [AUTOMATION] Page update wait timeout');
}

/**
 * Wait for document ready state using CDP
 */
async function waitForDocumentReady(
  webview: {
    waitForDocumentReady?: (targetState?: string, timeoutMs?: number) => Promise<{ success: boolean; readyState?: string; error?: string }>;
  },
  targetState: string = 'complete',
  timeoutMs: number = 10000
): Promise<boolean> {
  if (webview.waitForDocumentReady) {
    try {
      const result = await webview.waitForDocumentReady(targetState, timeoutMs);
      if (result.success) {
        console.log(`✅ [AUTOMATION] Document ready state: ${result.readyState || targetState}`);
        return true;
      } else {
        console.log(`⚠️ [AUTOMATION] Document ready wait failed: ${result.error}`);
        return false;
      }
    } catch (err) {
      console.log('⚠️ [AUTOMATION] Document ready check failed:', err);
      return false;
    }
  }
  
  // Fallback: assume ready after short delay
  console.log('⚠️ [AUTOMATION] waitForDocumentReady not available, using fallback');
  await new Promise(resolve => setTimeout(resolve, 500));
  return true;
}

/**
 * Wait for network idle using Performance API
 */
async function waitForNetworkIdle(
  webview: {
    waitForNetworkIdle?: (timeoutMs?: number, idleTimeMs?: number) => Promise<{ success: boolean; pendingRequests?: number; error?: string }>;
  },
  timeoutMs: number = 10000,
  idleTimeMs: number = 500
): Promise<boolean> {
  if (webview.waitForNetworkIdle) {
    try {
      const result = await webview.waitForNetworkIdle(timeoutMs, idleTimeMs);
      if (result.success) {
        console.log(`✅ [AUTOMATION] Network idle (${result.pendingRequests || 0} pending requests)`);
        return true;
      } else {
        console.log(`⚠️ [AUTOMATION] Network idle wait failed: ${result.error}, pending: ${result.pendingRequests || 'unknown'}`);
        // Don't fail completely - continue even if network isn't idle
        return true;
      }
    } catch (err) {
      console.log('⚠️ [AUTOMATION] Network idle check failed:', err);
      return true; // Continue anyway
    }
  }
  
  // Fallback: short delay
  await new Promise(resolve => setTimeout(resolve, 300));
  return true;
}

/**
 * Wait for element to be ready (visible and interactive) using CDP
 */
async function waitForElementReady(
  webview: {
    waitForElementReady?: (selector: string, timeoutMs?: number) => Promise<{ success: boolean; error?: string }>;
  },
  selector: string,
  timeoutMs: number = 5000
): Promise<boolean> {
  if (webview.waitForElementReady) {
    try {
      const result = await webview.waitForElementReady(selector, timeoutMs);
      if (result.success) {
        console.log(`✅ [AUTOMATION] Element ready: ${selector}`);
        return true;
      } else {
        console.log(`⚠️ [AUTOMATION] Element not ready: ${selector}, error: ${result.error}`);
        return false;
      }
    } catch (err) {
      console.log('⚠️ [AUTOMATION] Element ready check failed:', err);
      return false;
    }
  }
  
  // Fallback: assume element is ready after short delay
  console.log('⚠️ [AUTOMATION] waitForElementReady not available, using fallback');
  await new Promise(resolve => setTimeout(resolve, 200));
  return true;
}

/**
 * Legacy function - now uses event-based approach
 */
async function waitForPageUpdate(
  webview: { 
    getUrl: () => Promise<{ success: boolean; url?: string; error?: string }>;
    onDidFinishLoad?: () => Promise<{ success: boolean; error?: string }>;
    onDidStopLoading?: () => Promise<{ success: boolean; error?: string }>;
  },
  urlBefore: string,
  maxWaitMs: number = 2000
): Promise<void> {
  await waitForPageLoadEvent(webview, urlBefore, maxWaitMs);
}

/**
 * Run browser automation on the Electron webview
 * 
 * @param task - The task description for the automation
 * @param startingUrl - URL to start at (or null to use session's starting URL)
 * @param options - Automation options (useSession, maxSteps)
 * @param callbacks - Callbacks for various events
 */
export async function runWebviewAutomation(
  task: string,
  startingUrl: string | null,
  options: AutomationOptions = {},
  callbacks: AutomationCallbacks = {}
): Promise<AutomationResult> {
  const { useSession = true, maxSteps = 15 } = options;
  const history: AutomationAction[] = [];
  let sessionId: string | null = null;
  let synthesizedResult: SynthesizedResult | undefined;
  
  if (!isElectron()) {
    const error = 'Webview automation requires Electron environment';
    callbacks.onError?.(error);
    return { success: false, history, error };
  }
  
  const webview = window.api!.webview;
  
  try {
    // Wait for webview to be registered and ready
    console.log('🌐 [AUTOMATION] Waiting for webview to be ready...');
    const isReady = await waitForWebviewReady(5000);
    if (!isReady) {
      throw new Error('Webview not ready after 5 seconds');
    }
    
    // ========================================
    // SESSION INITIALIZATION
    // ========================================
    if (useSession) {
      console.log('🚀 [AUTOMATION] Starting autonomous session...');
      
      // Set up session callbacks
      agentSessionManager.setCallbacks({
        onSessionStarted: (session) => {
          console.log(`🚀 [AUTOMATION] Session started: ${session.sessionId}`);
        },
        onGoalStarted: (goal) => {
          console.log(`🎯 [AUTOMATION] Goal started: ${goal.description}`);
          callbacks.onGoalStarted?.(goal);
        },
        onGoalCompleted: (goalId) => {
          console.log(`✅ [AUTOMATION] Goal completed: ${goalId}`);
          callbacks.onGoalCompleted?.(goalId);
        },
        onFindingExtracted: (findings) => {
          console.log(`📝 [AUTOMATION] Extracted ${findings.length} findings`);
          callbacks.onFindingExtracted?.(findings);
        },
        onProgressUpdate: (progress) => {
          console.log(`📊 [AUTOMATION] Progress: ${progress.completed}/${progress.total}`);
          callbacks.onProgressUpdate?.(progress);
        },
        onReflection: (reflection) => {
          console.log(`🤔 [AUTOMATION] Reflection: on_track=${reflection.on_track}`);
          callbacks.onReflection?.(reflection);
        },
        onSessionCompleted: (result) => {
          console.log(`📊 [AUTOMATION] Session completed with confidence: ${result.confidence}`);
          callbacks.onSynthesizedResult?.(result);
        },
        onSessionError: (error) => {
          console.error(`🔴 [AUTOMATION] Session error: ${error}`);
        }
      });
      
      // Start the session
      const session = await agentSessionManager.startSession(task);
      sessionId = session.sessionId;
      
      // Use session's starting URL if none provided
      if (!startingUrl) {
        startingUrl = session.startingUrl;
      }
      
      // Notify about plan creation
      callbacks.onPlanCreated?.(session.goals);
    }
    
    // Ensure we have a starting URL
    if (!startingUrl) {
      startingUrl = 'https://www.google.com';
    }
    
    // Step 1: Navigate to starting URL
    console.log('🌐 [AUTOMATION] Starting automation for task:', task);
    console.log('🌐 [AUTOMATION] Navigating to:', startingUrl);
    
    callbacks.onUrlChange?.(startingUrl);
    const navResult = await webview.navigate(startingUrl);
    
    if (!navResult.success) {
      throw new Error(`Navigation failed: ${navResult.error}`);
    }
    
    // Wait for page to load using event-based approach
    console.log('⏳ [AUTOMATION] Waiting for page to load...');
    await waitForPageLoadEvent(webview, startingUrl, 10000);
    // Also wait for document ready state
    await waitForDocumentReady(webview, 'complete', 10000);
    // Optionally wait for network idle (non-blocking)
    await waitForNetworkIdle(webview, 5000, 500);
    
    // Track previous state for reflection
    let previousUrl = startingUrl;
    let lastAction = '';
    
    // Step 2: Run automation loop
    for (let step = 1; step <= maxSteps; step++) {
      console.log(`🤖 [AUTOMATION] Step ${step}/${maxSteps}`);
      callbacks.onStepStart?.(step, maxSteps);
      
      // Get current URL
      const urlResult = await webview.getUrl();
      const currentUrl = urlResult.success ? urlResult.url! : startingUrl;
      callbacks.onUrlChange?.(currentUrl);
      
      // Detect loops: same action repeated 3+ times OR repeated with no page change
      const recentActions = history.slice(-3);
      const sameActionRepeated = recentActions.length >= 3 && 
                                  recentActions.every(a => a.action === recentActions[0].action);
      const noUrlChange = recentActions.length >= 3 && 
                          recentActions.every(a => a.url_before === a.url_after);
      const allFailed = recentActions.length >= 3 && 
                        recentActions.every(a => !a.success);
      
      // Loop if: same action repeated with no results (failures OR no page change)
      const isLoop = sameActionRepeated && (allFailed || noUrlChange);
      
      // Also detect "stuck" state: repeated actions that don't change anything
      const isStuck = recentActions.length >= 2 && 
                      recentActions.every(a => a.action === recentActions[0].action) &&
                      noUrlChange;
      
      // Build failed actions list for LLM feedback
      const failedActions = history
        .filter(a => !a.success && a.error)
        .slice(-5) // Last 5 failed actions
        .map(a => `${a.action} (failed: ${a.error})`);
      
      // Also add "no change" warnings for actions that succeeded but did nothing
      const noChangeActions = history
        .filter(a => a.success && a.url_before === a.url_after && 
                     (a.action_type === 'click' || a.action_type === 'press'))
        .slice(-3)
        .map(a => `${a.action} (clicked but no page change)`);
      
      // Get ARIA snapshot (fast, structured, preferred method)
      console.log('🌳 [AUTOMATION] Getting ARIA snapshot...');
      const ariaResult = await webview.getAriaSnapshot();
      
      let ariaSnapshot: string | null = null;
      let screenshotBase64: string | null = null;
      let pageContent = '';
      
      if (ariaResult.success && ariaResult.snapshot) {
        ariaSnapshot = ariaResult.snapshot;
        const debug = (ariaResult as any).debug;
        if (debug) {
          console.log(`✅ [AUTOMATION] ARIA snapshot obtained (${ariaResult.refCount || 0} refs) - Page has ${debug.totalLinks} links (${debug.visibleLinks} visible), ${debug.totalButtons} buttons, ${debug.totalInputs} inputs`);
          // If very few refs but many visible links, log the snapshot for debugging
          if (ariaResult.refCount && ariaResult.refCount < 15 && debug.visibleLinks > 20) {
            console.log(`⚠️ [AUTOMATION] SNAPSHOT MISMATCH - only ${ariaResult.refCount} refs captured from ${debug.visibleLinks} visible links!`);
            console.log(`📋 [AUTOMATION] Full ARIA snapshot:\n${ariaSnapshot}`);
          }
        } else {
          console.log(`✅ [AUTOMATION] ARIA snapshot obtained (${ariaResult.refCount || 0} refs${ariaResult.truncated ? ', truncated' : ''})`);
        }
        // Skip getPageContent when we have ARIA snapshot - it's redundant
      } else {
        console.warn('⚠️ [AUTOMATION] ARIA snapshot failed, falling back to screenshot');
        // Fallback to screenshot if ARIA snapshot fails
        const screenshotResult = await webview.screenshot();
        if (screenshotResult.success && screenshotResult.screenshot) {
          screenshotBase64 = screenshotResult.screenshot;
        } else {
          // Last resort: get page content only if both ARIA and screenshot failed
          const contentResult = await webview.getPageContent();
          pageContent = contentResult.success 
            ? JSON.stringify(contentResult.content, null, 2)
            : '';
        }
      }
      
      // Send to backend to get next action with error feedback
      console.log('🧠 [AUTOMATION] Asking backend for next action...');
      const response = await fetch(`${BACKEND_URL}/api/browser/step`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          aria_snapshot: ariaSnapshot,  // Preferred: ARIA snapshot
          screenshot: screenshotBase64,  // Fallback: screenshot (only if ARIA failed)
          task,
          action_history: history.map(a => a.action),
          failed_actions: [...failedActions, ...noChangeActions],  // Include both failures and no-change actions
          is_loop: isLoop,
          is_stuck: isStuck,  // Flag when repeating same action without progress
          current_url: currentUrl,
          page_content: pageContent,  // Only sent as last resort
          step_number: step,
          max_steps: maxSteps,
          // Session intelligence data
          session_id: sessionId,
          previous_url: previousUrl,
          last_action: lastAction
        })
      });
      
      if (!response.ok) {
        throw new Error(`Backend returned ${response.status}: ${await response.text()}`);
      }
      
      const actionResponse = await response.json();
      
      if (!actionResponse.success) {
        throw new Error(actionResponse.error || 'Backend returned error');
      }
      
      // Process session-related response data
      if (sessionId && agentSessionManager.isSessionActive()) {
        agentSessionManager.processStepResponse(actionResponse);
      }
      
      const action: AutomationAction = {
        step,
        action: actionResponse.action,
        action_type: actionResponse.action_type,
        action_data: actionResponse.action_data,
        url: currentUrl
      };
      
      console.log(`🎯 [AUTOMATION] Action: ${action.action}`);
      callbacks.onAction?.(action);
      
      // Store for next iteration's reflection
      lastAction = action.action;
      
      // Check if task is complete
      if (action.action_type === 'done') {
        const reason = (action.action_data.reason as string) || 'Task completed';
        console.log('✅ [AUTOMATION] Task complete:', reason);
        history.push({ ...action, success: true });
        
        // Complete session and synthesize results if session is active
        if (sessionId && agentSessionManager.isSessionActive()) {
          try {
            synthesizedResult = await agentSessionManager.completeSession();
            callbacks.onSynthesizedResult?.(synthesizedResult);
          } catch (synthError) {
            console.error('🔴 [AUTOMATION] Session completion error:', synthError);
          }
        }
        
        callbacks.onComplete?.(reason, history);
        return { success: true, history, synthesizedResult };
      }
      
      // Execute the action on the webview with retry logic
      let actionSuccess = false;
      let actionError: string | undefined;
      const urlBefore = currentUrl;
      const maxRetries = 2; // Maximum retry attempts
      let retryCount = 0;
      
      // Retry function for failed actions
      const executeWithRetry = async (): Promise<{ success: boolean; error?: string }> => {
        while (retryCount <= maxRetries) {
          try {
            switch (action.action_type) {
              case 'click': {
                // Wait for element to be ready before clicking (except on retry)
                if (retryCount === 0) {
                  await waitForElementReady(webview, action.action_data.selector as string, 3000);
                }
                
                // For clicks, try scrolling into view before retry (except first attempt)
                if (retryCount > 0) {
                  try {
                    await webview.executeAction('scroll', { direction: 'down' });
                    // Scroll is instant, but wait a tiny bit for any animation
                    await new Promise(resolve => setTimeout(resolve, 100));
                  } catch {
                    // Ignore scroll errors
                  }
                }
                
                const result = await webview.executeAction('click', { 
                  selector: action.action_data.selector 
                });
                
                if (result.success) {
                  // Log what was clicked
                  if ((result as any).elementText) {
                    console.log(`🖱️ [AUTOMATION] Clicked element: "${(result as any).elementText}"`);
                  }
                  // Wait for page to finish loading after click (event-based)
                  await waitForPageLoadEvent(webview, urlBefore, 10000);
                  // Also ensure document is ready
                  await waitForDocumentReady(webview, 'complete', 5000);
                  return { success: true };
                } else if (retryCount < maxRetries) {
                  retryCount++;
                  console.log(`🔄 [AUTOMATION] Click failed, retrying (${retryCount}/${maxRetries})...`);
                  // Exponential backoff only, no fixed delay
                  await new Promise(resolve => setTimeout(resolve, retryCount * 200));
                  continue;
                } else {
                  return { success: false, error: result.error };
                }
              }
              
              case 'type': {
                // Wait for input element to be ready before typing
                if (retryCount === 0) {
                  await waitForElementReady(webview, action.action_data.selector as string, 3000);
                }
                
                const result = await webview.executeAction('type', {
                  selector: action.action_data.selector,
                  text: action.action_data.text
                });
                
                if (result.success) {
                  // No delay needed - typing is instant
                  // Only wait if we expect form submission (handled by press Enter)
                  return { success: true };
                } else if (retryCount < maxRetries) {
                  retryCount++;
                  console.log(`🔄 [AUTOMATION] Type failed, retrying (${retryCount}/${maxRetries})...`);
                  // Exponential backoff only
                  await new Promise(resolve => setTimeout(resolve, retryCount * 100));
                  continue;
                } else {
                  return { success: false, error: result.error };
                }
              }
              
              case 'press': {
                const result = await webview.executeAction('press', {
                  key: action.action_data.key
                });
                
                if (result.success) {
                  if (action.action_data.key === 'Enter') {
                    // Wait for page to load after pressing Enter (event-based)
                    await waitForPageLoadEvent(webview, urlBefore, 10000);
                    await waitForDocumentReady(webview, 'complete', 5000);
                  }
                  // No delay needed for other keys
                  return { success: true };
                } else if (retryCount < maxRetries) {
                  retryCount++;
                  console.log(`🔄 [AUTOMATION] Press failed, retrying (${retryCount}/${maxRetries})...`);
                  // Exponential backoff only
                  await new Promise(resolve => setTimeout(resolve, retryCount * 50));
                  continue;
                } else {
                  return { success: false, error: result.error };
                }
              }
              
              case 'navigate': {
                const url = action.action_data.url as string;
                const result = await webview.navigate(url);
                
                if (result.success) {
                  callbacks.onUrlChange?.(url);
                  // Wait for page to load using event-based approach
                  await waitForPageLoadEvent(webview, urlBefore, 10000);
                  await waitForDocumentReady(webview, 'complete', 10000);
                  // Optionally wait for network idle
                  await waitForNetworkIdle(webview, 5000, 500);
                  return { success: true };
                } else {
                  // Navigation failures usually shouldn't retry (URL might be invalid)
                  return { success: false, error: result.error };
                }
              }
              
              case 'scroll': {
                const result = await webview.executeAction('scroll', {
                  direction: action.action_data.direction
                });
                
                if (result.success) {
                  // Scroll is instant - no delay needed
                  return { success: true };
                } else {
                  // Scroll failures are usually non-critical
                  return { success: false, error: result.error };
                }
              }
              
              default:
                return { success: false, error: `Unknown action type: ${action.action_type}` };
            }
          } catch (execError) {
            if (retryCount < maxRetries) {
              retryCount++;
              console.log(`🔄 [AUTOMATION] Action error, retrying (${retryCount}/${maxRetries}):`, execError);
              // Exponential backoff only - no fixed base delay
              await new Promise(resolve => setTimeout(resolve, retryCount * 200));
              continue;
            } else {
              return { success: false, error: String(execError) };
            }
          }
        }
        
        return { success: false, error: 'Max retries exceeded' };
      };
      
      const retryResult = await executeWithRetry();
      actionSuccess = retryResult.success;
      actionError = retryResult.error;
      
      // Get URL after action
      const urlAfterResult = await webview.getUrl();
      const urlAfter = urlAfterResult.success ? urlAfterResult.url! : urlBefore;
      
      // Record action result with URL tracking
      history.push({
        ...action,
        success: actionSuccess,
        error: actionError,
        url_before: urlBefore,
        url_after: urlAfter
      });
      
      if (!actionSuccess) {
        console.warn(`⚠️ [AUTOMATION] Action failed: ${actionError}`);
        // Don't fail completely - let the LLM try a different approach
      } else if (urlBefore !== urlAfter) {
        console.log(`🌐 [AUTOMATION] URL changed: ${urlBefore} → ${urlAfter}`);
        callbacks.onUrlChange?.(urlAfter);
      }
      
      // No stabilization delay needed - we already waited for document ready and network idle
    }
    
    // Max steps reached
    console.log('⚠️ [AUTOMATION] Max steps reached');
    callbacks.onComplete?.('Max steps reached', history);
    return { success: true, history };
    
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('🔴 [AUTOMATION] Error:', errorMsg);
    callbacks.onError?.(errorMsg);
    return { success: false, history, error: errorMsg };
  }
}

/**
 * Check if webview automation is available
 */
export function isAutomationAvailable(): boolean {
  return isElectron() && !!window.api?.webview;
}

/**
 * Legacy wrapper for backward compatibility
 * @deprecated Use runWebviewAutomation with options parameter instead
 */
export async function runAutomation(
  task: string,
  startingUrl: string,
  maxSteps: number = 15,
  callbacks: AutomationCallbacks = {}
): Promise<AutomationResult> {
  return runWebviewAutomation(task, startingUrl, { maxSteps, useSession: true }, callbacks);
}

// Re-export session manager for direct access
export { agentSessionManager } from './agentSessionState';
export type { 
  SubGoal, 
  Finding, 
  ReflectionResult, 
  SessionProgress, 
  SynthesizedResult,
  AgentSession 
} from './agentSessionState';
