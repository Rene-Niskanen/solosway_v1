import type { CSSProperties } from 'react';

/**
 * Shared position logic for the search bar / chat bar container.
 * Same positioning rules everywhere; only the space below the bar (bottom offset) varies by context.
 */

/** Space from viewport bottom to the bottom of the input bar when fixed (e.g. small viewport).
 *  Must clear macOS dock (~60–80px). Use 80px min; CSS env(safe-area-inset-bottom) adds extra on notched displays. */
export const INPUT_BAR_SPACE_BELOW_DASHBOARD = 80;
/** Space below the input bar on map view (matches panel for consistent spacing). */
export const INPUT_BAR_SPACE_BELOW_MAP = 48;
/** Alias for map view; same as INPUT_BAR_SPACE_BELOW_MAP. */
export const INPUT_BAR_SPACE_BELOW_MAP_LARGE = 48;
/** Space below the input bar when it's in a flex panel (e.g. SideChatPanel fullscreen chat). */
export const INPUT_BAR_SPACE_BELOW_PANEL = 36;

/** Shared width constraints for the fixed input bar container. */
export const INPUT_BAR_CONTAINER_WIDTH = 'clamp(400px, 85vw, 650px)';

/** Minimum gap (px) between sidebar right edge and chat/search bar - ensures bar never abuts sidebar. */
export const SIDEBAR_TO_BAR_GAP_PX = 24;

/** Max width (px) for the dashboard SearchBar and SideChatPanel chat bar so they match. */
export const CHAT_BAR_MAX_WIDTH_PX = 660;

/** Max width (px) for dashboard SearchBar – slightly narrower than chat bar. */
export const SEARCH_BAR_MAX_WIDTH_PX = 640;

/** Style object for the bar wrapper – responsive: fills parent up to 680px so it adjusts to browser size. */
export const CHAT_BAR_WRAPPER_STYLE: CSSProperties = {
  width: `min(100%, ${CHAT_BAR_MAX_WIDTH_PX}px)`,
  minWidth: '200px',
  maxWidth: `${CHAT_BAR_MAX_WIDTH_PX}px`,
  flexShrink: 0,
  position: 'relative',
  boxSizing: 'border-box',
};

/** Right padding (px) for dashboard SearchBar wrapper – matches chat section for alignment. */
export const DASHBOARD_BAR_PADDING_RIGHT_PX = 16;

/** Max width (px) for ChatTabsBar – same as chat bar so tabs align with input below. */
export const CHAT_TABS_BAR_MAX_WIDTH_PX = 660;

/** Border for the chat bar (dashboard and SideChatPanel). Use with isDragOver for dashed variant. */
export const CHAT_BAR_BORDER = '1px solid rgba(0, 0, 0, 0.08)';
/** Border when drag-over (dashboard and SideChatPanel). */
export const CHAT_BAR_BORDER_DRAG = '2px dashed #E0E0E0';
/** Box shadow for the chat bar – same as dashboard so panel bar matches. */
export const CHAT_BAR_BOX_SHADOW = '0 2px 5px rgba(0, 0, 0, 0.05), 0 1px 2px rgba(0, 0, 0, 0.03)';

/** Max height (px) for chat input before it becomes scrollable. ~10 lines at 20px line-height. */
export const CHAT_INPUT_MAX_HEIGHT_PX = 200;

/**
 * Shared UI design for chat/search bar. Use in SearchBar and SideChatPanel for identical appearance.
 * Single source of truth for padding, heights, and layout so both bars match.
 */
export const CHAT_BAR_DESIGN = {
  /** Inner white container – padding, border, shadow, radius */
  INNER_CONTAINER: {
    PADDING_TOP: '16px',
    PADDING_BOTTOM: '16px',
    PADDING_RIGHT: '24px',
    PADDING_LEFT: '16px',
    MIN_HEIGHT: '160px',
    BORDER_RADIUS: '28px',
    BORDER_RADIUS_GLOW: '26px',
    BACKGROUND: '#ffffff',
  } as const,

  /** Drag-over state overlay */
  DRAG_OVERLAY: {
    MIN_HEIGHT: '120px',
    ICON_SIZE: 36,
  } as const,

  /** Input row wrapper (attachments + SegmentInput) */
  INPUT_ROW: {
    MIN_HEIGHT: '100px',
    GAP: '2px',
  } as const,

  /** Attachments row */
  ATTACHMENTS_ROW: {
    MARGIN_BOTTOM: '16px',
    MAX_HEIGHT: '80px',
  } as const,

  /** SegmentInput row */
  SEGMENT_INPUT_ROW: {
    MIN_HEIGHT: '100px',
    MARGIN_BOTTOM: '22px',
  } as const,

  /** SegmentInput field (textarea area) */
  SEGMENT_INPUT_FIELD: {
    PADDING_TOP: '10px',
    PADDING_BOTTOM: '4px',
    PADDING_RIGHT: '16px',
    PADDING_LEFT: '14px',
    LINE_HEIGHT: '20px',
  } as const,

  /** Button row – compact for empty state, tall for messages view */
  BUTTON_ROW: {
    MIN_HEIGHT_EMPTY: '24px',
    MIN_HEIGHT_MESSAGES: '36px',
    MARGIN_TOP: '-4px',
  } as const,
} as const;

/** Build bar inner container style (border depends on isDragOver). */
export function getChatBarInnerStyle(isDragOver: boolean, options?: { showGlow?: boolean; minHeight?: string; zIndex?: number; transition?: string; compact?: boolean }): CSSProperties {
  const { showGlow = false, zIndex, transition, compact = false } = options ?? {};
  const minHeight = options?.minHeight ?? (compact ? '152px' : CHAT_BAR_DESIGN.INNER_CONTAINER.MIN_HEIGHT);
  const pad = compact ? '14px' : CHAT_BAR_DESIGN.INNER_CONTAINER.PADDING_TOP;
  const base: CSSProperties = {
    background: CHAT_BAR_DESIGN.INNER_CONTAINER.BACKGROUND,
    border: showGlow ? '1px solid transparent' : (isDragOver ? CHAT_BAR_BORDER_DRAG : CHAT_BAR_BORDER),
    boxShadow: CHAT_BAR_BOX_SHADOW,
    position: 'relative',
    paddingTop: pad,
    paddingBottom: compact ? '16px' : CHAT_BAR_DESIGN.INNER_CONTAINER.PADDING_BOTTOM,
    paddingRight: compact ? '24px' : CHAT_BAR_DESIGN.INNER_CONTAINER.PADDING_RIGHT,
    paddingLeft: compact ? '16px' : CHAT_BAR_DESIGN.INNER_CONTAINER.PADDING_LEFT,
    overflow: 'visible',
    width: '100%',
    height: 'auto',
    minHeight,
    boxSizing: 'border-box',
    borderRadius: showGlow ? CHAT_BAR_DESIGN.INNER_CONTAINER.BORDER_RADIUS_GLOW : CHAT_BAR_DESIGN.INNER_CONTAINER.BORDER_RADIUS,
    transition: transition ?? (isDragOver ? 'border-color 0.08s ease-out' : 'border-color 0.2s ease-in-out'),
  };
  if (zIndex !== undefined) base.zIndex = zIndex;
  return base;
}

/** Build drag-over overlay style. */
export function getChatBarDragOverlayStyle(): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    minHeight: CHAT_BAR_DESIGN.DRAG_OVERLAY.MIN_HEIGHT,
    pointerEvents: 'none',
  };
}

/** Build attachments row style. */
export function getChatBarAttachmentsRowStyle(options?: { compact?: boolean }): CSSProperties {
  const compact = options?.compact ?? false;
  return {
    maxHeight: CHAT_BAR_DESIGN.ATTACHMENTS_ROW.MAX_HEIGHT,
    overflowY: 'auto',
    marginBottom: compact ? '14px' : CHAT_BAR_DESIGN.ATTACHMENTS_ROW.MARGIN_BOTTOM,
    flexShrink: 0,
    position: 'relative',
    zIndex: 10,
    pointerEvents: 'auto',
  };
}

/** Build SegmentInput row style. */
export function getChatBarSegmentInputRowStyle(options?: { compact?: boolean }): CSSProperties {
  const compact = options?.compact ?? false;
  return {
    height: 'auto',
    minHeight: compact ? '92px' : CHAT_BAR_DESIGN.SEGMENT_INPUT_ROW.MIN_HEIGHT,
    width: '100%',
    marginBottom: compact ? '20px' : CHAT_BAR_DESIGN.SEGMENT_INPUT_ROW.MARGIN_BOTTOM,
    flexShrink: 0,
  };
}

/** Build button row style. */
export function getChatBarButtonRowStyle(isEmptyState: boolean, isVeryNarrow: boolean, options?: { compact?: boolean }): CSSProperties {
  const compact = options?.compact ?? false;
  const minH = isVeryNarrow ? 'auto' : (isEmptyState ? CHAT_BAR_DESIGN.BUTTON_ROW.MIN_HEIGHT_EMPTY : CHAT_BAR_DESIGN.BUTTON_ROW.MIN_HEIGHT_MESSAGES);
  return {
    width: '100%',
    minWidth: '0',
    height: isVeryNarrow ? 'auto' : minH,
    minHeight: minH,
    flexShrink: 0,
    overflow: 'visible',
    marginTop: compact ? '-8px' : CHAT_BAR_DESIGN.BUTTON_ROW.MARGIN_TOP,
  };
}

/** Build SegmentInput component style object. */
export function getChatBarSegmentInputStyle(options?: { compact?: boolean }): CSSProperties {
  const compact = options?.compact ?? false;
  return {
    width: '100%',
    minHeight: compact ? '92px' : CHAT_BAR_DESIGN.SEGMENT_INPUT_ROW.MIN_HEIGHT,
    overflowY: 'auto',
    overflowX: 'hidden',
    lineHeight: CHAT_BAR_DESIGN.SEGMENT_INPUT_FIELD.LINE_HEIGHT,
    paddingTop: compact ? '16px' : CHAT_BAR_DESIGN.SEGMENT_INPUT_FIELD.PADDING_TOP,
    paddingBottom: compact ? '3px' : CHAT_BAR_DESIGN.SEGMENT_INPUT_FIELD.PADDING_BOTTOM,
    paddingRight: CHAT_BAR_DESIGN.SEGMENT_INPUT_FIELD.PADDING_RIGHT,
    paddingLeft: CHAT_BAR_DESIGN.SEGMENT_INPUT_FIELD.PADDING_LEFT,
    boxSizing: 'border-box',
  };
}

/**
 * Shared layout constants for dashboard and chat section empty state.
 * Must be identical so search bar + welcome message have the same vertical position when switching between dashboard and chat.
 */
export const DASHBOARD_CHAT_LAYOUT = {
  /** Top spacer height – pushes logo + bar down so bar center lands at ~50vh */
  TOP_SPACER_HEIGHT: 'calc(50vh - 400px)',
  /** Logo-equivalent section min height (dashboard logo + greeting + margins) */
  LOGO_SECTION_MIN_HEIGHT: '200px',
  /** Margin below logo section – space between welcome block and chat bar */
  LOGO_SECTION_MARGIN_BOTTOM: '1.5rem',
  /** Gap between welcome message (logo + greeting) and search/chat bar */
  WELCOME_TO_BAR_GAP: '24px',
  /** Horizontal padding for content – same on dashboard and chat. Left uses SIDEBAR_TO_BAR_GAP_PX so bar never abuts sidebar. */
  HORIZONTAL_PADDING: 'clamp(1rem, 2vw, 1rem)',
  /** Left padding specifically – must match SIDEBAR_TO_BAR_GAP_PX so chat area uses sidebar right edge as position logic. */
  HORIZONTAL_PADDING_LEFT: '24px',
  /** Logo section max width – wide enough for "Hey {name}, What can I help you with today?" on one line in big view */
  LOGO_SECTION_MAX_WIDTH: '640px',
  /** Logo section min width */
  LOGO_SECTION_MIN_WIDTH: '200px',
  /** Top padding to match dashboard's content container (p-8 lg:p-16) so welcome/bar align */
  CONTAINER_TOP_PADDING: 'clamp(2rem, 5vw, 4rem)',
  /** Horizontal padding – must match MainContent p-8 lg:p-16 so chat aligns with dashboard */
  CONTENT_CONTAINER_PADDING: 'clamp(2rem, 5vw, 4rem)',
} as const;

/** Bar left position (px from viewport) - matches dashboard. Use when agent sidebar may change panel width. */
export function getBarLeftPx(sidebarWidthPx: number, agentSidebarReservePx = 0): number {
  const contentAreaWidth = (typeof window !== 'undefined' ? window.innerWidth : 1920) - sidebarWidthPx - agentSidebarReservePx - 128;
  const maxW5xlLeft = 64 + Math.max(0, (contentAreaWidth - 1024) / 2);
  const barContainerLeft = maxW5xlLeft + 24;
  const barOffset = (984 - CHAT_BAR_MAX_WIDTH_PX) / 2;
  return sidebarWidthPx + barContainerLeft + barOffset;
}

/** CSS left for bar to match dashboard position. Must include agentSidebarReserve when ChatPanel is open. */
export function getBarFixedLeftCss(sidebarWidthPx: number, agentSidebarReservePx = 0): string {
  return `calc(${sidebarWidthPx}px + 64px + 24px + ${(984 - CHAT_BAR_MAX_WIDTH_PX) / 2}px + (100vw - ${sidebarWidthPx}px - ${agentSidebarReservePx}px - 128px - 1024px) / 2)`;
}

export interface InputBarFixedContainerOptions {
  /** Override left (e.g. '50%' or 'calc(50vw + 116px)'). */
  left?: string;
  /** Override transform (e.g. 'translateX(-50%)'). */
  transform?: string;
  /** Override z-index. */
  zIndex?: number;
  /** Override maxHeight. */
  maxHeight?: string;
}

/**
 * Base styles for a fixed input bar container. Same position logic everywhere;
 * only spaceBelow (and optional left/transform) vary by context.
 */
export function getInputBarFixedContainerStyles(
  spaceBelowPx: number,
  options: InputBarFixedContainerOptions = {}
): CSSProperties {
  const {
    left = '50%',
    transform = 'translateX(-50%)',
    zIndex = 10000,
    maxHeight = 'calc(100vh - 48px)',
  } = options;

  return {
    position: 'fixed',
    bottom: `${spaceBelowPx}px`,
    left,
    transform,
    zIndex,
    width: INPUT_BAR_CONTAINER_WIDTH,
    maxWidth: INPUT_BAR_CONTAINER_WIDTH,
    maxHeight,
    boxSizing: 'border-box',
    display: 'block',
    minHeight: '60px',
    overflow: 'visible',
    pointerEvents: 'auto',
  };
}
