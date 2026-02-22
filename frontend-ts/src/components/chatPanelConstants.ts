/**
 * Single source of truth for chat panel width values used across SideChatPanel,
 * MainContent, and StandaloneExpandedCardView.
 */
export const CHAT_PANEL_WIDTH = {
  /** Default collapsed width (px) */
  COLLAPSED: 382.5,
  /** Expanded width as viewport percentage */
  EXPANDED_VW: 42.5,
  /** Minimum width during navigation tasks (px) */
  NAV_MIN: 380,
  /** Minimum width for document preview when open (px) - matches chat collapsed width */
  DOC_PREVIEW_MIN: 380,
  /** Minimum width for the projects (left) side when dragging the chat panel divider (px) */
  PROJECTS_MIN: 480,
} as const;
