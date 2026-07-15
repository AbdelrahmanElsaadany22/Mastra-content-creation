/**
 * Shared text measurement used by every platform validator.
 *
 * Character counts here are over code points, not UTF-16 units, so an emoji counts as one
 * character rather than two. Platforms that weight characters differently (X) do their own
 * counting — see twitter-tools.ts.
 */

export const HASHTAG_PATTERN = /#[\p{L}\p{N}_]+/gu;
export const URL_PATTERN = /https?:\/\/[^\s]+/g;
export const MENTION_PATTERN = /@[\p{L}\p{N}_.]+/gu;
export const EMOJI_PATTERN = /\p{Extended_Pictographic}/u;

/** Markdown that renders literally on platforms with no markdown support. */
export const MARKDOWN_PATTERN = /(\*\*|__|^#{1,6}\s|\[.+\]\(.+\))/m;

export const countChars = (text: string): number => [...text].length;

export const extractHashtags = (text: string): string[] => text.match(HASHTAG_PATTERN) ?? [];
export const extractUrls = (text: string): string[] => text.match(URL_PATTERN) ?? [];
export const extractMentions = (text: string): string[] => text.match(MENTION_PATTERN) ?? [];

/** The text a reader sees before a "see more" style fold. */
export const foldPreview = (text: string, cutoff: number): string =>
  [...text].slice(0, cutoff).join('');

/**
 * True when nothing resolves before the fold. A reader gets a complete thought only if a
 * sentence or line ends somewhere inside the visible window — not merely if the window
 * happens to stop on a boundary.
 */
export const isCutMidThought = (text: string, cutoff: number): boolean =>
  countChars(text) > cutoff && !/[.!?\n]/.test(foldPreview(text, cutoff));

export const countWords = (text: string): number =>
  text.trim().split(/\s+/).filter(Boolean).length;

/** Graphemes, so ZWJ emoji sequences (👨‍👩‍👧) count once rather than per component. */
export const toGraphemes = (text: string): string[] => {
  const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
  return [...segmenter.segment(text)].map(s => s.segment);
};

export const countEmoji = (text: string): number =>
  toGraphemes(text).filter(g => EMOJI_PATTERN.test(g)).length;
