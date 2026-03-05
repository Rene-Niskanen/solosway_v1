import type { CSSProperties } from 'react';

/**
 * Shared position logic for the search bar / chat bar container.
 * Same positioning rules everywhere; only the space below the bar (bottom offset) varies by context.
 */

/** Space from viewport bottom to the bottom of the input bar (px). Use for fixed containers. */
export const INPUT_BAR_SPACE_BELOW_DASHBOARD = 32;
/** Space below the input bar on map view (matches panel for consistent spacing). */
export const INPUT_BAR_SPACE_BELOW_MAP = 48;
/** Alias for map view; same as INPUT_BAR_SPACE_BELOW_MAP. */
export const INPUT_BAR_SPACE_BELOW_MAP_LARGE = 48;
/** Space below the input bar when it's in a flex panel (e.g. SideChatPanel fullscreen chat). */
export const INPUT_BAR_SPACE_BELOW_PANEL = 48;

/** Shared width constraints for the fixed input bar container. */
export const INPUT_BAR_CONTAINER_WIDTH = 'clamp(400px, 85vw, 650px)';

/** Max width (px) for the dashboard SearchBar and SideChatPanel chat bar so they match. */
export const CHAT_BAR_MAX_WIDTH_PX = 680;

/** Max height (px) for chat input before it becomes scrollable. ~10 lines at 20px line-height. */
export const CHAT_INPUT_MAX_HEIGHT_PX = 200;

/**
 * Shared layout constants for dashboard and chat section empty state.
 * Must be identical so search bar + welcome message have the same vertical position when switching between dashboard and chat.
 */
export const DASHBOARD_CHAT_LAYOUT = {
  /** Top spacer height – pushes logo + bar down so bar center lands at ~50vh */
  TOP_SPACER_HEIGHT: 'calc(50vh - 400px)',
  /** Logo-equivalent section min height (dashboard logo + greeting + margins) */
  LOGO_SECTION_MIN_HEIGHT: '200px',
  /** Margin below logo section – matches dashboard logo maxHeight + clamp margins */
  LOGO_SECTION_MARGIN_BOTTOM: '5rem',
  /** Gap between welcome message (logo + greeting) and search/chat bar */
  WELCOME_TO_BAR_GAP: '40px',
  /** Horizontal padding for content – same on dashboard and chat */
  HORIZONTAL_PADDING: 'clamp(1rem, 2vw, 1rem)',
  /** Logo section max width */
  LOGO_SECTION_MAX_WIDTH: '480px',
  /** Logo section min width */
  LOGO_SECTION_MIN_WIDTH: '200px',
  /** Top padding to match dashboard's content container (p-8 lg:p-16) so welcome/bar align */
  CONTAINER_TOP_PADDING: 'clamp(2rem, 5vw, 4rem)',
} as const;

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
