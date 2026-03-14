import React from "react";

/** Sizes tuned to match PlanSelectionModal feature list (similar scale to FeatureIcon h-3.5 w-3.5) */
const CIRCLE_SIZE_PX = 16;
const OVERLAP_PX = 8;
const ICON_SIZE_PX = 10;

const MODEL_ICONS = [
  { src: "/OpenAIIcon.png", alt: "OpenAI" },
  { src: "/GeminiIcon.png", alt: "Gemini" },
  { src: "/ClaudeIcon.png", alt: "Claude" },
] as const;

/**
 * Stacked model icons (OpenAI, Gemini, Claude) in the same style as
 * SearchingSourcesCarousel—overlapping circles with white backgrounds, stacked vertically.
 */
export function StackedModelIcons({ className }: { className?: string }) {
  const stackedHeight =
    CIRCLE_SIZE_PX + (CIRCLE_SIZE_PX - OVERLAP_PX) * (MODEL_ICONS.length - 1);

  return (
    <span
      role="img"
      aria-label="AI models: OpenAI, Gemini, Claude"
      className={className}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "flex-start",
        width: CIRCLE_SIZE_PX,
        minWidth: CIRCLE_SIZE_PX,
        height: stackedHeight,
        flexShrink: 0,
        overflow: "visible",
        position: "relative",
      }}
    >
      <span
        style={{
          display: "inline-flex",
          flexDirection: "column",
          alignItems: "center",
          position: "relative",
          overflow: "visible",
        }}
      >
        {MODEL_ICONS.map((model, i) => (
          <span
            key={model.src}
            style={{
              width: CIRCLE_SIZE_PX,
              height: CIRCLE_SIZE_PX,
              minHeight: CIRCLE_SIZE_PX,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              marginTop: i === 0 ? 0 : -OVERLAP_PX,
              position: "relative",
              zIndex: i,
              borderRadius: "50%",
              backgroundColor: "#fff",
              border: "1px solid rgba(0, 0, 0, 0.08)",
              boxSizing: "border-box",
            }}
          >
            <img
              src={model.src}
              alt=""
              aria-hidden
              style={{
                width: ICON_SIZE_PX,
                height: ICON_SIZE_PX,
                objectFit: "contain",
              }}
            />
          </span>
        ))}
      </span>
    </span>
  );
}

export default StackedModelIcons;
