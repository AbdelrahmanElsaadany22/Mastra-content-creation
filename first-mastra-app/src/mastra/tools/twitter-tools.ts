import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import {
  EMOJI_PATTERN,
  countEmoji,
  extractHashtags,
  extractMentions,
  extractUrls,
  toGraphemes,
} from './text-utils';

/**
 * X does not count characters — it counts weight, per twitter-text config v3.
 * https://github.com/twitter/twitter-text/blob/master/config/v3.json
 *
 * Latin, Arabic, Cyrillic and similar (code point <= 4351) weigh 100. Everything else, including
 * CJK and emoji, weighs 200. Any URL counts as exactly 23 characters regardless of its real
 * length, because X rewrites it to a t.co link. The budget is 280 at scale 100.
 */
const X_MAX_WEIGHT = 280 * 100;
const X_DEFAULT_WEIGHT = 200;
const X_LIGHT_WEIGHT = 100;
const X_SCALE = 100;
const X_URL_WEIGHT = 23 * 100;
const X_LIGHT_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0, 4351],
  [8192, 8205],
  [8208, 8223],
  [8242, 8247],
];

const isLightCodePoint = (cp: number): boolean =>
  X_LIGHT_RANGES.some(([start, end]) => cp >= start && cp <= end);

/** Weighted length in X's units, before dividing by scale. */
function rawWeight(text: string): number {
  let withoutUrls = text;
  let weight = 0;

  for (const url of extractUrls(text)) {
    withoutUrls = withoutUrls.replace(url, '');
    weight += X_URL_WEIGHT;
  }

  for (const grapheme of toGraphemes(withoutUrls)) {
    // An emoji — including a multi-code-point ZWJ sequence — counts once at default weight.
    if (EMOJI_PATTERN.test(grapheme)) {
      weight += X_DEFAULT_WEIGHT;
      continue;
    }
    for (const char of grapheme) {
      const cp = char.codePointAt(0) ?? 0;
      weight += isLightCodePoint(cp) ? X_LIGHT_WEIGHT : X_DEFAULT_WEIGHT;
    }
  }

  return weight;
}

/** What X reports as the character count for a tweet. */
export const weightedLength = (text: string): number => Math.ceil(rawWeight(text) / X_SCALE);

export const validateTweet = createTool({
  id: 'validate-tweet',
  description:
    "Measure a tweet using X's real weighted character rules: links always cost 23 regardless of length, CJK and emoji cost 2, Latin and Arabic cost 1. Run this on every tweet — a plain character count will not match what X reports.",
  inputSchema: z.object({
    tweet: z.string().describe('A single tweet, exactly as it would be posted'),
  }),
  outputSchema: z.object({
    weightedLength: z.number().describe("The count X itself will show"),
    plainCharacterCount: z.number().describe('Naive count, for comparison only'),
    remaining: z.number(),
    withinLimit: z.boolean(),
    urls: z.array(z.string()),
    hashtags: z.array(z.string()),
    mentions: z.array(z.string()),
    issues: z.array(z.string()),
  }),
  execute: async ({ tweet }) => {
    const weighted = weightedLength(tweet);
    const urls = extractUrls(tweet);
    const hashtags = extractHashtags(tweet);
    const mentions = extractMentions(tweet);
    const issues: string[] = [];

    if (weighted > 280) {
      issues.push(`${weighted}/280 — cut ${weighted - 280}. Note links always cost 23 each.`);
    }
    if (hashtags.length > 2) {
      issues.push(`${hashtags.length} hashtags. On X, more than 1-2 reads as spam and costs reach.`);
    }
    if (tweet.trimStart().startsWith('@')) {
      issues.push(
        'Opening with @mention makes this a reply — only followers of both accounts see it. Put a character before it if that is not intended.',
      );
    }
    if (countEmoji(tweet) > 3) {
      issues.push('Heavy emoji use reads as engagement bait on X.');
    }

    return {
      weightedLength: weighted,
      plainCharacterCount: [...tweet].length,
      remaining: 280 - weighted,
      withinLimit: weighted <= 280,
      urls,
      hashtags,
      mentions,
      issues,
    };
  },
});

export const splitIntoThread = createTool({
  id: 'split-into-thread',
  description:
    'Split long text into a numbered thread where every tweet fits X\'s 280 weighted limit, breaking on paragraph and sentence boundaries rather than mid-sentence. Use whenever the content does not fit one tweet.',
  inputSchema: z.object({
    text: z.string().describe('The full text to split'),
    numbering: z
      .enum(['none', 'slash', 'emoji'])
      .default('slash')
      .describe('slash appends " 1/5", emoji appends " 🧵1/5", none omits counters'),
  }),
  outputSchema: z.object({
    tweets: z.array(z.object({ position: z.number(), text: z.string(), weightedLength: z.number() })),
    tweetCount: z.number(),
    issues: z.array(z.string()),
  }),
  execute: async ({ text, numbering }) => {
    const issues: string[] = [];
    const suffixFor = (i: number, total: number) => {
      // A lone tweet is not a thread; "1/1" is noise.
      if (numbering === 'none' || total < 2) return '';
      return numbering === 'emoji' ? ` 🧵${i}/${total}` : ` ${i}/${total}`;
    };

    // Sentence-level units, kept inside their paragraphs so breaks land on real boundaries.
    const units = text
      .split(/\n\s*\n/)
      .flatMap(para => para.trim().match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g) ?? [])
      .map(s => s.trim())
      .filter(Boolean);

    const pack = (total: number): string[] => {
      const out: string[] = [];
      let current = '';

      for (const unit of units) {
        const candidate = current ? `${current} ${unit}` : unit;
        const budget = 280 - weightedLength(suffixFor(out.length + 1, total));

        if (weightedLength(candidate) <= budget) {
          current = candidate;
          continue;
        }
        if (current) out.push(current);

        // A single sentence longer than one tweet has no clean break; split on words.
        if (weightedLength(unit) > budget) {
          let chunk = '';
          for (const word of unit.split(/\s+/)) {
            const next = chunk ? `${chunk} ${word}` : word;
            if (weightedLength(next) > budget) {
              if (chunk) out.push(chunk);
              chunk = word;
            } else {
              chunk = next;
            }
          }
          current = chunk;
        } else {
          current = unit;
        }
      }
      if (current) out.push(current);
      return out;
    };

    // Suffix length depends on the total, which depends on the packing — settle it in two passes.
    let parts = pack(1);
    parts = pack(parts.length);

    const tweets = parts.map((body, i) => {
      const full = `${body}${suffixFor(i + 1, parts.length)}`;
      return { position: i + 1, text: full, weightedLength: weightedLength(full) };
    });

    const overflow = tweets.filter(t => t.weightedLength > 280);
    if (overflow.length > 0) {
      issues.push(
        `Tweets ${overflow.map(t => t.position).join(', ')} still exceed 280 and need manual editing.`,
      );
    }

    return { tweets, tweetCount: tweets.length, issues };
  },
});
