/**
 * Agent Session State Manager
 * 
 * Manages autonomous browsing sessions on the frontend.
 * Tracks goals, findings, and session progress.
 * Communicates with backend session endpoints.
 */

import { env } from '@/config/env';

// ============================================================================
// Types
// ============================================================================

export interface SubGoal {
  id: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  parent_id?: string | null;
  dependencies: string[];
  expected_result: string;
  result?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
}

export interface Finding {
  id: string;
  fact: string;
  source_url: string;
  extraction_method: string;
  confidence: number;
  timestamp: string;
  goal_id: string;
  element_ref?: string | null;
  raw_text?: string | null;
  metadata?: Record<string, unknown>;
}

export interface ReflectionResult {
  on_track: boolean;
  goal_achieved: boolean;
  should_extract: boolean;
  suggested_action: 'continue' | 'backtrack' | 'replan' | 'extract' | 'done';
  reasoning: string;
  confidence?: number;
  alternative_approach?: string | null;
}

export interface SessionProgress {
  completed: number;
  failed: number;
  total: number;
  current_goal: SubGoal | null;
  all_complete: boolean;
}

export interface SessionStats {
  findings_count: number;
  urls_visited: number;
  actions_taken: number;
  successful_actions: number;
  failed_actions: number;
  has_hypothesis: boolean;
  open_questions: number;
  status: string;
  duration_seconds: number;
}

export interface SynthesizedResult {
  answer: string;
  summary: string;
  findings: Finding[];
  sources: string[];
  confidence: number;
  caveats: string[];
  data_points: Record<string, unknown>;
  stats?: SessionStats;
}

export interface AgentSession {
  sessionId: string;
  originalTask: string;
  goals: SubGoal[];
  findings: Finding[];
  currentGoalIndex: number;
  startingUrl: string;
  status: 'active' | 'completed' | 'failed' | 'timeout';
  createdAt: Date;
}

export interface StepResponse {
  success: boolean;
  action: string;
  action_type: string;
  action_data: Record<string, unknown>;
  step_number: number;
  session_id?: string;
  goal_completed?: boolean;
  findings?: Finding[];
  current_goal?: {
    id: string;
    description: string;
    status: string;
  };
  reflection?: ReflectionResult;
  progress?: SessionProgress;
  error?: string;
}

// ============================================================================
// Session Callbacks
// ============================================================================

export interface SessionCallbacks {
  onSessionStarted?: (session: AgentSession) => void;
  onGoalStarted?: (goal: SubGoal) => void;
  onGoalCompleted?: (goalId: string, result?: string) => void;
  onGoalFailed?: (goalId: string, reason: string) => void;
  onFindingExtracted?: (findings: Finding[]) => void;
  onProgressUpdate?: (progress: SessionProgress) => void;
  onReflection?: (reflection: ReflectionResult) => void;
  onSessionCompleted?: (result: SynthesizedResult) => void;
  onSessionError?: (error: string) => void;
}

// ============================================================================
// AgentSessionManager Class
// ============================================================================

export class AgentSessionManager {
  private session: AgentSession | null = null;
  private callbacks: SessionCallbacks = {};
  private backendUrl: string;

  constructor() {
    this.backendUrl = env.backendUrl;
  }

  /**
   * Set callbacks for session events
   */
  setCallbacks(callbacks: SessionCallbacks): void {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  /**
   * Get the current session
   */
  getSession(): AgentSession | null {
    return this.session;
  }

  /**
   * Get the current session ID
   */
  getSessionId(): string | null {
    return this.session?.sessionId || null;
  }

  /**
   * Check if a session is active
   */
  isSessionActive(): boolean {
    return this.session !== null && this.session.status === 'active';
  }

  /**
   * Start a new autonomous browsing session
   */
  async startSession(task: string): Promise<AgentSession> {
    console.log('🚀 [SESSION] Starting session for task:', task.substring(0, 50) + '...');

    try {
      const response = await fetch(`${this.backendUrl}/api/browser/session/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ task }),
      });

      if (!response.ok) {
        throw new Error(`Failed to start session: ${response.statusText}`);
      }

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to start session');
      }

      // Create local session state
      this.session = {
        sessionId: data.session_id,
        originalTask: task,
        goals: data.goals || [],
        findings: [],
        currentGoalIndex: 0,
        startingUrl: data.starting_url || 'https://www.google.com',
        status: 'active',
        createdAt: new Date(),
      };

      console.log(`🚀 [SESSION] Session ${this.session.sessionId} started with ${this.session.goals.length} goals`);

      // Notify callbacks
      this.callbacks.onSessionStarted?.(this.session);
      
      if (this.session.goals.length > 0) {
        this.callbacks.onGoalStarted?.(this.session.goals[0]);
      }

      return this.session;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      console.error('🔴 [SESSION] Failed to start session:', errorMsg);
      this.callbacks.onSessionError?.(errorMsg);
      throw error;
    }
  }

  /**
   * Complete the current session and get synthesized results
   */
  async completeSession(): Promise<SynthesizedResult> {
    if (!this.session) {
      throw new Error('No active session to complete');
    }

    console.log(`📊 [SESSION] Completing session ${this.session.sessionId}`);

    try {
      const response = await fetch(`${this.backendUrl}/api/browser/session/complete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          session_id: this.session.sessionId,
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to complete session: ${response.statusText}`);
      }

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to complete session');
      }

      const result: SynthesizedResult = {
        answer: data.answer,
        summary: data.summary || '',
        findings: data.findings || [],
        sources: data.sources || [],
        confidence: data.confidence || 0,
        caveats: data.caveats || [],
        data_points: data.data_points || {},
        stats: data.stats,
      };

      // Update session status
      this.session.status = 'completed';

      console.log(`📊 [SESSION] Session completed with confidence: ${result.confidence}`);

      // Notify callbacks
      this.callbacks.onSessionCompleted?.(result);

      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      console.error('🔴 [SESSION] Failed to complete session:', errorMsg);
      this.callbacks.onSessionError?.(errorMsg);
      throw error;
    }
  }

  /**
   * Get the current status of the session
   */
  async getSessionStatus(): Promise<SessionProgress | null> {
    if (!this.session) {
      return null;
    }

    try {
      const response = await fetch(
        `${this.backendUrl}/api/browser/session/status?session_id=${this.session.sessionId}`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.ok) {
        return null;
      }

      const data = await response.json();
      return data.progress || null;
    } catch (error) {
      console.error('🔴 [SESSION] Failed to get session status:', error);
      return null;
    }
  }

  /**
   * Get the current goal being worked on
   */
  getCurrentGoal(): SubGoal | null {
    if (!this.session || this.session.goals.length === 0) {
      return null;
    }

    // Find first non-completed, non-failed goal
    const currentGoal = this.session.goals.find(
      (g) => g.status !== 'completed' && g.status !== 'failed'
    );

    return currentGoal || null;
  }

  /**
   * Process step response from backend
   */
  processStepResponse(response: StepResponse): void {
    if (!this.session || !response.session_id) {
      return;
    }

    // Update findings
    if (response.findings && response.findings.length > 0) {
      this.session.findings.push(...response.findings);
      this.callbacks.onFindingExtracted?.(response.findings);
    }

    // Handle goal completion
    if (response.goal_completed && response.current_goal) {
      this.callbacks.onGoalCompleted?.(response.current_goal.id);
      
      // Update local goal status
      const goal = this.session.goals.find((g) => g.id === response.current_goal!.id);
      if (goal) {
        goal.status = 'completed';
      }
    }

    // Handle reflection
    if (response.reflection) {
      this.callbacks.onReflection?.(response.reflection);
    }

    // Handle progress update
    if (response.progress) {
      this.callbacks.onProgressUpdate?.(response.progress);

      // Update local goals from progress
      if (response.progress.current_goal) {
        const currentGoal = this.session.goals.find(
          (g) => g.id === response.progress!.current_goal!.id
        );
        if (currentGoal) {
          currentGoal.status = response.progress.current_goal.status;
          this.callbacks.onGoalStarted?.(currentGoal);
        }
      }
    }
  }

  /**
   * Add a finding to the local session
   */
  addFinding(finding: Finding): void {
    if (this.session) {
      this.session.findings.push(finding);
    }
  }

  /**
   * Mark a goal as complete locally
   */
  markGoalComplete(goalId: string): void {
    if (!this.session) return;

    const goal = this.session.goals.find((g) => g.id === goalId);
    if (goal) {
      goal.status = 'completed';
      this.callbacks.onGoalCompleted?.(goalId);

      // Find next goal
      const nextGoal = this.session.goals.find(
        (g) => g.status !== 'completed' && g.status !== 'failed'
      );
      if (nextGoal) {
        nextGoal.status = 'in_progress';
        this.callbacks.onGoalStarted?.(nextGoal);
      }
    }
  }

  /**
   * Mark a goal as failed locally
   */
  markGoalFailed(goalId: string, reason: string): void {
    if (!this.session) return;

    const goal = this.session.goals.find((g) => g.id === goalId);
    if (goal) {
      goal.status = 'failed';
      goal.result = `FAILED: ${reason}`;
      this.callbacks.onGoalFailed?.(goalId, reason);
    }
  }

  /**
   * Get all findings for the session
   */
  getFindings(): Finding[] {
    return this.session?.findings || [];
  }

  /**
   * Get findings for a specific goal
   */
  getFindingsForGoal(goalId: string): Finding[] {
    if (!this.session) return [];
    return this.session.findings.filter((f) => f.goal_id === goalId);
  }

  /**
   * Get the starting URL for the session
   */
  getStartingUrl(): string {
    return this.session?.startingUrl || 'https://www.google.com';
  }

  /**
   * Check if all goals are complete
   */
  areAllGoalsComplete(): boolean {
    if (!this.session || this.session.goals.length === 0) {
      return false;
    }
    return this.session.goals.every(
      (g) => g.status === 'completed' || g.status === 'failed'
    );
  }

  /**
   * Get progress summary
   */
  getProgressSummary(): { completed: number; total: number; percentage: number } {
    if (!this.session || this.session.goals.length === 0) {
      return { completed: 0, total: 0, percentage: 0 };
    }

    const completed = this.session.goals.filter((g) => g.status === 'completed').length;
    const total = this.session.goals.length;
    const percentage = Math.round((completed / total) * 100);

    return { completed, total, percentage };
  }

  /**
   * Reset/clear the current session
   */
  clearSession(): void {
    console.log('🧹 [SESSION] Clearing session');
    this.session = null;
  }

  /**
   * Set session as failed
   */
  markSessionFailed(reason: string): void {
    if (this.session) {
      this.session.status = 'failed';
      this.callbacks.onSessionError?.(reason);
    }
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

export const agentSessionManager = new AgentSessionManager();
