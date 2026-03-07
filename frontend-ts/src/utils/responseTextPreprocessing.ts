/**
 * Shared preprocessing for AI response text before Markdown rendering.
 * Keeps SideChatPanel and FloatingChatBubble behaviour aligned (ChatGPT-like formatting).
 */

/** Balance unclosed ** so ReactMarkdown can parse bold without showing raw markdown. */
export function ensureBalancedBoldForDisplay(text: string): string {
  const count = (text.match(/\*\*/g) || []).length;
  if (count % 2 !== 0) {
    if (text.trimEnd().endsWith('**')) {
      return text.trimEnd().slice(0, -2);
    }
    return text + '**';
  }
  return text;
}

/**
 * Insert paragraph breaks before bold section labels so titles appear on their own lines.
 * Handles: ". **Property Details:**" -> ".\n\n**Property Details:**"
 * and: " - **Lease Duration:**" -> "\n\n**Lease Duration:**" (dash is a separator, drop it).
 */
export function ensureParagraphBreaksBeforeBoldSections(text: string): string {
  return text.replace(/(\.\s*|\s-\s)\s*\*\*([^*]+):\*\*/g, (_m, prefix: string, label: string) => {
    if (/^\s-\s$/.test(prefix)) return `\n\n**${label}:**`; // dash separator before title: drop it
    return `${prefix.trimEnd()}\n\n**${label}:**`;
  });
}

/** Insert newline after **Label:** when followed by text so description is a separate paragraph. */
export function ensureNewlineAfterBoldLabel(text: string): string {
  return text.replace(/(\*\*[^*]+:\*\*)\s+(?=[A-Za-z0-9])/g, '$1\n\n');
}

/**
 * Strip redundant colon before normal text so we don't show "Property Description:: The property...".
 * LLM often outputs ": The property..." after a bold label; remove that leading ": " or ": ".
 * Runs multiple passes to catch different formats.
 */
export function stripRedundantColonAfterBoldLabel(text: string): string {
  let out = text;
  // (1) **Label:** + anything + ": " -> **Label:** + single space
  out = out.replace(/(\*\*[^*]+:\*\*)(?:\s|\[\d+\]|[-])*\s*:\s+/g, '$1 ');
  // (2) Any line that starts with ": " (redundant colon) - strip it, keep one space before the word
  //    Use [\r\n] to handle Windows line endings; \s* allows optional leading space on the line
  out = out.replace(/(^|[\r\n]+)(\s*):\s+/g, '$1$2 ');
  // (3) Same line: "**Label:** : " (space-colon-space) when not caught above
  out = out.replace(/(\*\*[^*]+:\*\*)\s+:\s+/g, '$1 ');
  // (4) Bullet line with redundant colon: "- : The" or "* : The" -> "- The" / "* The"
  out = out.replace(/([\r\n]+\s*[-*+]\s*)\s*:\s+/g, '$1');
  // (5) Redundant colon after citation marker (same line): "[1]: The" or "%%CITATION_N%%: The" -> "[1] The" (so we don't show ": The...")
  out = out.replace(/(\[\d+\])\s*:\s+/g, '$1 ');
  out = out.replace(/(%%CITATION_(?:SUPERSCRIPT|BRACKET|PENDING)_\d+%%)\s*:\s+/g, '$1 ');
  return out;
}

/** Normalize Unicode circled numbers (①②③) to bracket citations [1][2][3]. */
export function normalizeCircledCitationsToBracket(text: string): string {
  const circledMap: Record<string, string> = {
    '①': '[1]', '②': '[2]', '③': '[3]', '④': '[4]', '⑤': '[5]',
    '⑥': '[6]', '⑦': '[7]', '⑧': '[8]', '⑨': '[9]', '⑩': '[10]',
    '⑪': '[11]', '⑫': '[12]', '⑬': '[13]', '⑭': '[14]', '⑮': '[15]',
    '⑯': '[16]', '⑰': '[17]', '⑱': '[18]', '⑲': '[19]', '⑳': '[20]',
  };
  let out = text;
  Object.entries(circledMap).forEach(([circled, bracket]) => {
    out = out.split(circled).join(bracket);
  });
  return out;
}

/** Remove period (and optional space before it) after bracket citations so we NEVER show "." after a citation. [1]. -> [1], [1] . -> [1], [7]. Next -> [7] Next */
export function removePeriodAfterBracketCitations(text: string): string {
  return text.replace(/\[(\d+)\]\s*\./g, '[$1]');
}

/** Strip internal BLOCK_CITE_ID markers so they never appear in the UI (e.g. "(BLOCK_CITE_ID_15)", "BLOCK_CITE_ID_99"). */
export function stripBlockCiteIdFromDisplay(text: string): string {
  if (!text || typeof text !== 'string') return text;
  return text
    .replace(/[ \t]*[\[\(]?BLOCK_CITE_ID_\d+[\]\)]?[ \t]*/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ');
}

/** Remove orphan lines that are only clause refs (e.g. "C1.1.1") or parsing artifacts that leak from document structure. */
export function stripOrphanFragmentLines(text: string): string {
  if (!text || typeof text !== 'string') return text;
  const lines = text.split('\n');
  const result: string[] = [];
  const clauseRefOnly = /^\s*(?:C\d+(?:\.\d+)*|\d+(?:\.\d+)+)\s*$/i;
  for (const line of lines) {
    if (line.trim() !== '' && clauseRefOnly.test(line)) {
      // Skip orphan clause ref lines (parsing artifacts)
      continue;
    }
    result.push(line);
  }
  return result.join('\n');
}

/** Normalize [ID: 1](BLOCK_CITE_ID_N) or [ID: 1] to [1] so citation matching and display use bracket numbers. */
export function normalizeIdCitationsToBracket(text: string): string {
  if (!text || typeof text !== 'string') return text;
  return text.replace(/\[ID:\s*(\d+)\](?:\s*\(\s*BLOCK_CITE_ID_\d+\s*\))?/g, '[$1]');
}

/**
 * Move bracket citations out of split noun phrases so "a [1] bedroom cottage"
 * becomes "a bedroom cottage[1]" and "1 [1] bedroom" becomes "1 bedroom[1]".
 * Also unwraps bracket citations that replaced a date day: "[1] April" → "1 April".
 */
export function rebalanceBracketCitationPlacement(text: string): string {
  if (!text || typeof text !== 'string') return text;

  const months = '(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)';
  const dateDayRe = new RegExp(`\\[(\\d{1,2})\\](\\s*(?:\\*\\*)?\\s*)(${months})\\b`, 'gi');
  let result = text.replace(dateDayRe, '$1$2$3');

  const roomWords = '(?:bedroom|bathroom|bed|bath|room)';
  const dwellingWords = '(?:cottage|apartment|flat|house|villa|unit|property|home|maisonette|duplex)';
  const nounPhrase = `(?:(?:\\d+|one|two|three|four|five|six|seven|eight|nine|ten)\\s+)?${roomWords}(?:\\s+${dwellingWords})?`;
  const articleRe = new RegExp(`\\b(a|an|the)\\s+(\\[\\d+\\])\\s+(${nounPhrase})`, 'gi');
  result = result.replace(articleRe, '$1 $3$2');
  const countNounPhrase = `${roomWords}(?:\\s+${dwellingWords})?`;
  const countRe = new RegExp(`\\b((?:\\d+|one|two|three|four|five|six|seven|eight|nine|ten))\\s+(\\[\\d+\\])\\s+(${countNounPhrase})`, 'gi');
  result = result.replace(countRe, '$1 $3$2');
  return result;
}

/**
 * Convert list items that are only a bold section label (e.g. "- **Parties Involved:**") into
 * plain bold lines so they render as section titles, not bullets. Handles - * + and optional leading whitespace.
 */
export function promoteBoldSectionLabelsFromListItems(text: string): string {
  return text.replace(/^(\s*)[-*+]\s+(\*\*[^*]+:\*\*\s*)$/gm, '$1$2');
}

/**
 * Merge consecutive list items that are one logical bullet (e.g. "Windy Ridge: ..." followed by "Asking KES 120 million; sold for ...").
 * The LLM often outputs two "- " lines when they describe the same item; this converts the second into a continuation line
 * so markdown renders a single list item (indented continuation per CommonMark).
 */
export function mergeConsecutiveListItemsAsOne(text: string): string {
  const lines = text.split('\n');
  const result: string[] = [];
  const bulletStart = /^\s*([-*+])\s+/;
  const continuationStart = /^(Asking|Sold|Price|Listed|Sale price|Offers?|KES|USD|EUR|GBP|No firm|Received|Sold for|Asking price)/i;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const prev = result[result.length - 1];
    const bulletMatch = line.match(bulletStart);
    const trimmedAfterBullet = bulletMatch ? line.slice(line.indexOf(bulletMatch[0]) + bulletMatch[0].length).trim() : '';
    const prevTrimmed = prev != null ? prev.trim() : '';
    const prevIsBullet = prevTrimmed !== '' && bulletStart.test(prevTrimmed);
    if (bulletMatch && prev != null && prevIsBullet && continuationStart.test(trimmedAfterBullet)) {
      if (prevTrimmed !== '') result.push('');
      result.push('    ' + trimmedAfterBullet);
    } else {
      result.push(line);
    }
  }
  return result.join('\n');
}

/**
 * Convert list-like blocks to markdown bullets and bold sub-headings.
 * (1) When a line ends with ":" (e.g. "includes:" or "features:") and is followed by plain lines, prefix those with "- ".
 * (2) When a short standalone line (e.g. "Bathroom", "Kitchen") is followed by plain lines, bold the line and prefix the following lines with "- ".
 * (3) When a line is just **Label:** (bold label only), add bullets to the following description lines until the next **Label:** or section.
 */
export function ensureBulletPointsForListLikeBlocks(text: string): string {
  const lines = text.split(/\n/);
  const result: string[] = [];
  const listIntroWithColon = /:\s*$/; // line ends with colon (optional trailing space)
  const boldLabelOnly = /^\s*\*\*[^*]+:\*\*\s*$/; // just **Label:** — not a list intro, the next line is
  const alreadyList = /^(\s*)([-*]\s|\d+\.\s)/; // already starts with - or * or 1.
  const looksLikeSection = /^(\s*)(#+\s|\*\*)/; // heading or bold label
  const maxListItems = 50;
  const maxSubheadingLen = 50; // "Bathroom", "Kitchen", "General Checklist" etc.

  const isShortSubheading = (s: string): boolean => {
    const t = s.trim();
    return t.length >= 1 && t.length <= maxSubheadingLen && !t.includes('**') && !/^#+\s/.test(t) && !t.endsWith('.');
  };
  const looksLikeListItem = (s: string): boolean => {
    const t = s.trim();
    return t.length > 15 || t.endsWith('.');
  };

  const addBulletsToFollowingLines = (startIdx: number): number => {
    let j = startIdx;
    while (j < lines.length && lines[j].trim() === '') {
      result.push(lines[j]);
      j++;
    }
    let count = 0;
    while (j < lines.length && count < maxListItems) {
      const next = lines[j];
      const trimmed = next.trim();
      if (trimmed === '') break;
      if (looksLikeSection.test(next)) break;
      if (alreadyList.test(next)) {
        result.push(next);
      } else {
        result.push(next.replace(/^\s*/, (m) => m + '- '));
      }
      j++;
      count++;
    }
    return j - 1; // return last processed index
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Case A: Short sub-heading (e.g. "Bathroom", "Kitchen") followed by list items — bold it and add bullets
    if (isShortSubheading(trimmed) && i + 1 < lines.length) {
      let j = i + 1;
      while (j < lines.length && lines[j].trim() === '') j++;
      const firstNext = j < lines.length ? lines[j] : '';
      if (j < lines.length && !looksLikeSection.test(firstNext) && !alreadyList.test(firstNext) && looksLikeListItem(firstNext)) {
        const leading = line.match(/^\s*/)?.[0] ?? '';
        result.push(trimmed.startsWith('**') ? line : `${leading}**${trimmed}**`);
        const lastIdx = addBulletsToFollowingLines(i + 1);
        i = lastIdx;
        i++;
        continue;
      }
    }

    result.push(line);

    // Case B: Line ends with ":" (list intro, but not just **Label:**) — add bullets to following lines
    if (
      listIntroWithColon.test(trimmed) &&
      !boldLabelOnly.test(trimmed) &&
      i + 1 < lines.length
    ) {
      const lastIdx = addBulletsToFollowingLines(i + 1);
      i = lastIdx;
    } else if (boldLabelOnly.test(trimmed) && i + 1 < lines.length) {
      // Case C: **Label:** on its own line — bullet the following description line(s) until next **Label:** or section
      const lastIdx = addBulletsToFollowingLines(i + 1);
      i = lastIdx;
    }
    i++;
  }
  return result.join('\n');
}

/**
 * Merge a line that is only bold text (e.g. **Market**) with the next line when the next
 * line is a short continuation (e.g. "Overview") so that "Market Overview" renders as one
 * bold heading instead of bold "Market" on one line and plain "Overview" on the next.
 */
export function mergeBoldHeadingWithNextLine(text: string): string {
  const lines = text.split('\n');
  const result: string[] = [];
  const maxContinuationLen = 30;
  // Line is only optional space + **content** + optional space; exclude **Label:** (colon before closing **)
  const boldOnlyLine = /^\s*\*\*([^*]+)\*\*\s*$/;
  const boldLabelWithColon = /^\s*\*\*[^*]*:\*\*\s*$/;
  const listStart = /^\s*([-*+]\s|\d+\.\s)/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(boldOnlyLine);
    if (match && !boldLabelWithColon.test(line) && i + 1 < lines.length) {
      const boldContent = match[1].trim();
      const nextLine = lines[i + 1];
      const nextTrimmed = nextLine.trim();
      const isShortContinuation =
        nextTrimmed.length >= 1 &&
        nextTrimmed.length <= maxContinuationLen &&
        !nextTrimmed.includes('**') &&
        !listStart.test(nextLine) &&
        !nextTrimmed.endsWith('.');
      if (isShortContinuation) {
        const combined = `${boldContent} ${nextTrimmed}`.trim();
        const leading = line.match(/^\s*/)?.[0] ?? '';
        result.push(leading + `**${combined}**`);
        i++; // skip next line
        continue;
      }
    }
    result.push(line);
  }
  return result.join('\n');
}

/**
 * Merge lines that contain only citations (e.g. "[4]" or "[4] [5]") with the previous line.
 * Prevents citations from appearing on their own line when the LLM outputs paragraph breaks.
 */
export function mergeCitationOnlyLinesWithPrevious(text: string): string {
  const lines = text.split(/\n/);
  const citationOnlyRe = /^\s*(?:\[\d+\]\s*)*(?:\[\d+\])\s*(?:\[\d+\]\s*)*\s*$/; // line is only [1], [2], [1] [2], etc.
  const result: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed !== '' && citationOnlyRe.test(line)) {
      // Citation-only line: merge with previous non-empty line
      while (result.length > 0 && result[result.length - 1].trim() === '') {
        result.pop();
      }
      if (result.length > 0) {
        result[result.length - 1] = (result[result.length - 1] + ' ' + trimmed).trimEnd();
      } else {
        result.push(line);
      }
      continue;
    }
    result.push(line);
  }
  return result.join('\n');
}

/**
 * Convert inline " - " bullet runs into proper markdown list items so they render with indentation.
 * (1) "**Label:** - item" → "**Label:**\n- item" so the first bullet is a real list item.
 * (2) On the same line, further " - " that look like list separators (preceded by . or ; or ") ") become newlines.
 * Avoids splitting "8.0 kg - dimensions" by only splitting when preceded by sentence-end or quote.
 */
export function convertInlineDashedBulletsToMarkdownLists(text: string): string {
  let out = text;
  // **Label:** - first item (and optionally more on same line) → label on own line, then "- item" per line
  out = out.replace(/(\*\*[^*]+:\*\*)\s+-\s+/g, '$1\n- ');
  // Within a line that already has "- item", split " - " that starts a new phrase (after . ; or ") ")
  out = out.replace(/([.;)])\s+-\s+/g, '$1\n- ');
  return out;
}

/** Merge very short orphan lines (e.g. "of 2025") with the previous line. */
export function mergeOrphanLines(text: string): string {
  const maxOrphanLen = 20;
  const lines = text.split(/\n/);
  const markdownStart = /^[\s#*\->\d.]/;
  const result: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const prev = result[result.length - 1];
    const isShort = line.trim().length > 0 && line.trim().length <= maxOrphanLen;
    const prevEndsWithOfOrComma = prev != null && (/\s+of\s*$/.test(prev) || /,\s*$/.test(prev));
    const notMarkdown = !markdownStart.test(line.trim());
    if (i > 0 && isShort && prevEndsWithOfOrComma && notMarkdown) {
      result[result.length - 1] = (prev + ' ' + line.trim()).trimEnd();
    } else {
      result.push(line);
    }
  }
  return result.join('\n');
}

/**
 * Run the full preprocessing pipeline on response text (no citation substitution).
 * Use this before passing text to ReactMarkdown so both SideChatPanel and FloatingChatBubble
 * get the same structure.
 *
 * Deliberately minimal: we balance bold markers, merge orphan fragments, normalize
 * circled citations, and merge consecutive list items that are one logical bullet —
 * but we do NOT force paragraph breaks after bold labels, auto-convert text to bullet
 * lists, or insert section breaks. Let the LLM's markdown flow naturally.
 */
export function prepareResponseTextForDisplay(text: string): string {
  if (!text || typeof text !== 'string') return text;
  // Normalize [ID: X](BLOCK_CITE_ID_N) -> [X] and strip any remaining BLOCK_CITE_ID so they never leak into the UI
  let out = normalizeIdCitationsToBracket(text);
  out = stripBlockCiteIdFromDisplay(out);
  out = rebalanceBracketCitationPlacement(out);
  out = stripOrphanFragmentLines(out);
  const withBold = ensureBalancedBoldForDisplay(out);
  const withSectionBreaks = ensureParagraphBreaksBeforeBoldSections(withBold);
  const noDoubleColon = stripRedundantColonAfterBoldLabel(withSectionBreaks);
  const withNewlineAfterLabel = ensureNewlineAfterBoldLabel(noDoubleColon);
  const withListFormatting = convertInlineDashedBulletsToMarkdownLists(withNewlineAfterLabel);
  const withMergedHeadings = mergeBoldHeadingWithNextLine(withListFormatting);
  const withMergedOrphans = mergeOrphanLines(withMergedHeadings);
  const withMergedCitations = mergeCitationOnlyLinesWithPrevious(withMergedOrphans);
  const withMergedListItems = mergeConsecutiveListItemsAsOne(withMergedCitations);
  const withPromotedTitles = promoteBoldSectionLabelsFromListItems(withMergedListItems);
  const withBracketCitations = normalizeCircledCitationsToBracket(withPromotedTitles);
  const noPeriodAfterCite = removePeriodAfterBracketCitations(withBracketCitations);
  // Final pass: catch any redundant ": " at line start that later steps might have preserved
  return stripRedundantColonAfterBoldLabel(noPeriodAfterCite);
}

/**
 * Convert response text to plain text for copy/paste: strip markdown and remove citation markers.
 * Use when copying response to clipboard so pasted text is readable without ** or [1], [2], etc.
 */
export function textForCopy(text: string): string {
  if (!text || typeof text !== 'string') return '';
  let out = text;
  // Remove citation markers [1], [2], [12], etc.
  out = out.replace(/\s*\[\d+\]\s*/g, ' ');
  // Strip bold: **text** then __text__
  out = out.replace(/\*\*([^*]*)\*\*/g, '$1');
  out = out.replace(/__([^_]*)__/g, '$1');
  // Strip italic only when space-bound (avoid breaking file_name): *italic* or _italic_
  out = out.replace(/(^|\s)\*([^*]+)\*($|\s)/g, '$1$2$3');
  out = out.replace(/(^|\s)_([^_]+)_($|\s)/g, '$1$2$3');
  // Headers: # ## ### -> remove # and keep text
  out = out.replace(/^#{1,6}\s+/gm, '');
  // Inline code: `code` -> code
  out = out.replace(/`([^`]*)`/g, '$1');
  // Collapse multiple spaces and trim
  out = out.replace(/\n{3,}/g, '\n\n').replace(/  +/g, ' ').trim();
  return out;
}
