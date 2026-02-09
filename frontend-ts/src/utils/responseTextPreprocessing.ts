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
 * get the same structure (label-value newlines, no orphan lines, normalized circled refs).
 */
export function prepareResponseTextForDisplay(text: string): string {
  const withBold = ensureBalancedBoldForDisplay(text);
  const withSections = ensureParagraphBreaksBeforeBoldSections(withBold);
  const withLabelNewlines = ensureNewlineAfterBoldLabel(withSections);
  const withBullets = ensureBulletPointsForListLikeBlocks(withLabelNewlines);
  const withMergedOrphans = mergeOrphanLines(withBullets);
  return normalizeCircledCitationsToBracket(withMergedOrphans);
}
