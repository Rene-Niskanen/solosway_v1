import type { CSSProperties } from 'react';

/**
 * Shared position logic for the search bar / chat bar container.
 * Same positioning rules everywhere; only the space below the bar (bottom offset) varies by context.
 */

/** Space from viewport bottom to the bottom of the input bar (px). Use for fixed containers. */
export const INPUT_BAR_SPACE_BELOW_DASHBOARD = 32;
export const INPUT_BAR_SPACE_BELOW_MAP = 24;
/** Larger space below when map has more chrome (e.g. MapChatBar-style placement). */
export const INPUT_BAR_SPACE_BELOW_MAP_LARGE = 48;
/** Space below the input bar when it's in a flex panel (e.g. SideChatPanel). Same as dashboard to avoid jump when typing. */
export const INPUT_BAR_SPACE_BELOW_PANEL = 32;

/** Shared width constraints for the fixed input bar container. */
export const INPUT_BAR_CONTAINER_WIDTH = 'clamp(400px, 85vw, 650px)';

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
