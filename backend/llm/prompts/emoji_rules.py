"""
Emoji usage logic: mode, scoring, budget, function-based picks, placement.

Used in prompts so the model applies consistent emoji rules. Optional
Python helper for computing emoji_allowed / emoji_budget when inputs
(mode, user message, context) are available for injection.

Exports:
- EMOJI_USAGE_RULES: str (prompt text for the model)
- emoji_preset(mode, *, user_no_emojis=False) -> dict (optional helper)
"""

from typing import Literal

# --- Prompt text for the model ---

EMOJI_USAGE_RULES = """
---

## EMOJI USAGE (MODE, BUDGET, PLACEMENT)

**1) Choose the mode for this message**

Pick one per reply; it overrides other emoji guidance.

- **Professional / Compliance (emoji = OFF):** Legal, finance, medical, contracts, reports, sensitive topics. Use no emojis.
- **Neutral / Product (emoji = LOW):** Onboarding, help docs, UI-style copy, B2B, support. At most 0–1 emoji (e.g. ✅ or ⚠️), only when it clearly helps.
- **Casual / Social (emoji = MED–HIGH):** Community, social, chatty assistant. Up to 1–3 emojis; keep them purposeful.

**Hard stops:** If the user says "no emojis" / "keep it professional" / "no emoji", use zero emojis. If the topic is legal, compliance, or formal financial advice, default to Professional (OFF).

**2) Emoji intensity score (0–100, for your reasoning)**

Start at 0, then mentally add/subtract to decide how many emojis are appropriate:

- User message contains emojis → +25
- User asked for "more fun / friendly / casual" → +20
- User said "no emojis / keep it professional" → -100 (hard stop)
- Content is tweet / caption / marketing hook → +25
- Content is UX microcopy (tooltips, empty states) → +10
- Content is technical spec / code / academic / legal / financial → -25 to -60 (legal/compliance/finance: -60)
- Sensitive context (money owed, disputes, health anxiety, layoffs, breakup) → -40
- User seems upset/angry (caps, insults, "wtf") → -30
- Reply under ~20 words → +10 (one emoji can help tone); over ~200 words → -10 (multiple can look spammy)

Clamp to 0–100, then apply the budget in (3).

**3) Budget and caps**

- **0–14 (effectively OFF):** No emojis.
- **15–34 (LOW):** 0–1 emoji total, usually at end.
- **35–64 (MED):** 1–3 emojis total.
- **65–100 (HIGH):** Only in casual/social; 3–6 max.

Rules:
- Never more than 1 emoji per sentence.
- Never repeat the same emoji (no "🔥🔥🔥").
- In Professional mode, no emojis in headings/titles.

**4) Pick emojis by function, not decoration**

Use an emoji only if it does one of these:

- **Tone softener (friendly, non-threatening):** 🙂 ✅ 👀
- **Structure / scannability (lists, steps):** ✅ ➜ 🔹 📋
- **Emphasis (marketing/casual only):** 🚀 🔥 💡
- **Caution / warning:** ⚠️ 🛑

**Avoid:** 😂 💀 🙏 in professional product contexts (can feel juvenile or culturally loaded). Avoid 😘 🥵 🍆 and similar. No excessive hearts unless the user uses them first.

**5) Placement**

- Put emojis **after** the phrase they modify, not before (exception: bullet labels like "✅ Step 1").
- Prefer end-of-sentence over mid-sentence.
- Never attach emojis to numbers in finance/legal contexts.

**6) Default for this product (B2B-style assistant)**

When in doubt: **Neutral / Product (LOW)** — max 1 emoji per reply, and only ✅ or ⚠️ when they clearly add clarity or tone. Omit otherwise.
"""


# --- Optional: preset helper for injection (e.g. future "emoji_allowed", "emoji_budget" in prompt) ---

EmojiMode = Literal["professional", "neutral", "casual"]


def emoji_preset(
    mode: EmojiMode,
    *,
    user_no_emojis: bool = False,
) -> dict:
    """
    Return emoji_allowed and emoji_budget for the given mode.
    Use when you have explicit mode (e.g. workspace setting) to inject into the prompt.
    """
    if user_no_emojis or mode == "professional":
        return {"emoji_allowed": False, "emoji_budget": 0}
    if mode == "neutral":
        return {"emoji_allowed": True, "emoji_budget": 1}  # max 1, only ✅ or ⚠️
    # casual
    return {"emoji_allowed": True, "emoji_budget": 5}  # 3–6 range, use 5 as default cap
