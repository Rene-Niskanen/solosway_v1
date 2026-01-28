/**
 * Shared style constants for Plan components
 * Provides consistent Cursor-like styling across PlanViewer, ExpandedPlanViewer,
 * PlanReasoningSteps, and AdjustmentBlock
 */

export const PLAN_STYLES = {
  colors: {
    // Backgrounds
    bg: '#FFFFFF',
    bgHover: '#F9FAFB',
    bgMuted: '#F3F4F6',
    bgSubtle: '#FAFAFA',
    
    // Borders
    border: '#E5E7EB',
    borderSubtle: '#F3F4F6',
    
    // Text
    text: '#111827',
    textSecondary: '#374151',
    textMuted: '#6B7280',
    textSubtle: '#9CA3AF',
    
    // Diff colors
    added: '#DCFCE7',
    addedBorder: '#BBF7D0',
    addedText: '#166534',
    addedGutter: '#22C55E',
    removed: '#FEE2E2',
    removedBorder: '#FECACA',
    removedText: '#991B1B',
    removedGutter: '#EF4444',
    
    // Accents
    accent: '#3B82F6',
    accentHover: '#2563EB',
    amber: '#D97706',
    amberHover: '#B45309',
    green: '#10B981',
    greenHover: '#059669',
    error: '#EF4444',
  },
  
  fonts: {
    mono: "'SF Mono', 'Monaco', 'Menlo', 'Consolas', monospace",
    ui: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  },
  
  sizes: {
    fontXs: '11px',
    fontSm: '12px',
    fontBase: '13px',
    fontMd: '14px',
    fontLg: '16px',
    lineNumber: '11px',
    iconSm: '12px',
    iconBase: '14px',
    iconMd: '16px',
  },
  
  spacing: {
    xs: '4px',
    sm: '6px',
    md: '8px',
    lg: '12px',
    xl: '16px',
    xxl: '20px',
  },
  
  radii: {
    sm: '4px',
    md: '6px',
    lg: '8px',
  },
  
  transitions: {
    fast: '100ms ease',
    normal: '150ms ease',
    slow: '200ms ease',
  },
  
  shadows: {
    sm: '0 1px 2px rgba(0, 0, 0, 0.05)',
    md: '0 1px 3px rgba(0, 0, 0, 0.1)',
    lg: '0 4px 6px rgba(0, 0, 0, 0.1)',
  },
  
  // Line number column width
  lineNumberWidth: '36px',
  gutterWidth: '20px',
} as const;

// Type for the styles object
export type PlanStylesType = typeof PLAN_STYLES;
