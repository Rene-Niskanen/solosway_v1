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

/** Insert paragraph breaks before bold section labels (e.g. **Flood Zone 2:**). */
export function ensureParagraphBreaksBeforeBoldSections(text: string): string {
  return text.replace(/(\.\s*|\s-\s)\s*\*\*([^*]+):\*\*/g, '$1\n\n**$2:**');
}

/** Insert newline after **Label:** when followed by text so description is a separate paragraph. */
export function ensureNewlineAfterBoldLabel(text: string): string {
  return text.replace(/(\*\*[^*]+:\*\*)\s+(?=[A-Za-z0-9])/g, '$1\n\n');
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
  const withBold = ensureBalancedBoldForDisplay(text);
  const withMergedHeadings = mergeBoldHeadingWithNextLine(withBold);
  const withMergedOrphans = mergeOrphanLines(withMergedHeadings);
  const withMergedListItems = mergeConsecutiveListItemsAsOne(withMergedOrphans);
  const withPromotedTitles = promoteBoldSectionLabelsFromListItems(withMergedListItems);
  const withBracketCitations = normalizeCircledCitationsToBracket(withPromotedTitles);
  return removePeriodAfterBracketCitations(withBracketCitations);
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
