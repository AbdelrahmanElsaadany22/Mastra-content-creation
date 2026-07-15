import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { countChars, countWords } from './text-utils';

/** Adult non-fiction silent reading averages ~238 wpm; 225 is a reasonable working figure. */
const WORDS_PER_MINUTE = 225;
const TITLE_PIXEL_SAFE_LENGTH = 60;
const META_DESCRIPTION_MAX = 155;
const LONG_PARAGRAPH_WORDS = 120;

type Heading = { level: number; text: string; line: number };

const parseHeadings = (markdown: string): Heading[] =>
  markdown.split('\n').flatMap((line, i) => {
    const match = /^(#{1,6})\s+(.*)$/.exec(line.trim());
    return match?.[1] && match[2] ? [{ level: match[1].length, text: match[2], line: i + 1 }] : [];
  });

export const analyzeArticleStructure = createTool({
  id: 'analyze-article-structure',
  description:
    'Analyse a markdown article draft: word count, reading time, heading hierarchy, and overlong paragraphs. Run on every draft before showing it to the user. Markdown IS supported here, unlike social posts.',
  inputSchema: z.object({
    markdown: z.string().describe('The full article in markdown'),
  }),
  outputSchema: z.object({
    wordCount: z.number(),
    readingTimeMinutes: z.number(),
    headings: z.array(z.object({ level: z.number(), text: z.string(), line: z.number() })),
    h1Count: z.number(),
    paragraphCount: z.number(),
    longParagraphs: z
      .array(z.object({ index: z.number(), words: z.number(), preview: z.string() }))
      .describe('Paragraphs likely to lose the reader'),
    issues: z.array(z.string()),
  }),
  execute: async ({ markdown }) => {
    const headings = parseHeadings(markdown);
    const wordCount = countWords(markdown.replace(/^#{1,6}\s+.*$/gm, ''));
    const issues: string[] = [];

    const paragraphs = markdown
      .split(/\n\s*\n/)
      .map(p => p.trim())
      .filter(p => p && !/^#{1,6}\s/.test(p) && !/^[-*+>|]/.test(p) && !p.startsWith('```'));

    const longParagraphs = paragraphs.flatMap((p, i) => {
      const words = countWords(p);
      return words > LONG_PARAGRAPH_WORDS
        ? [{ index: i + 1, words, preview: p.slice(0, 60) }]
        : [];
    });

    const h1Count = headings.filter(h => h.level === 1).length;
    if (h1Count > 1) {
      issues.push(`${h1Count} H1 headings. An article should have exactly one.`);
    }

    // A jump from H2 straight to H4 breaks the document outline for screen readers and crawlers.
    for (let i = 1; i < headings.length; i++) {
      const prev = headings[i - 1];
      const current = headings[i];
      if (prev && current && current.level > prev.level + 1) {
        issues.push(
          `Heading level jumps from H${prev.level} to H${current.level} at line ${current.line} ("${current.text}"). Do not skip levels.`,
        );
      }
    }

    if (longParagraphs.length > 0) {
      issues.push(
        `${longParagraphs.length} paragraph(s) over ${LONG_PARAGRAPH_WORDS} words. Break them up.`,
      );
    }
    if (wordCount > 300 && headings.filter(h => h.level >= 2).length === 0) {
      issues.push('No subheadings in a long article; readers scan before they read.');
    }

    return {
      wordCount,
      readingTimeMinutes: Math.max(1, Math.round(wordCount / WORDS_PER_MINUTE)),
      headings,
      h1Count,
      paragraphCount: paragraphs.length,
      longParagraphs,
      issues,
    };
  },
});

export const checkSeoMetadata = createTool({
  id: 'check-seo-metadata',
  description:
    'Check an article title and meta description against search-result display limits, and verify the target keyword actually appears. Run before delivering any article intended for search traffic.',
  inputSchema: z.object({
    title: z.string().describe('The article title / SEO title tag'),
    metaDescription: z.string().describe('The meta description'),
    targetKeyword: z.string().optional().describe('Primary keyword, if the user gave one'),
  }),
  outputSchema: z.object({
    titleLength: z.number(),
    metaDescriptionLength: z.number(),
    keywordInTitle: z.boolean().optional(),
    keywordInMetaDescription: z.boolean().optional(),
    issues: z.array(z.string()),
    caveat: z.string(),
  }),
  execute: async ({ title, metaDescription, targetKeyword }) => {
    const titleLength = countChars(title);
    const metaLength = countChars(metaDescription);
    const issues: string[] = [];

    if (titleLength > TITLE_PIXEL_SAFE_LENGTH) {
      issues.push(
        `Title is ${titleLength} characters; Google usually truncates past ~${TITLE_PIXEL_SAFE_LENGTH}. Front-load the important words.`,
      );
    }
    if (titleLength < 20) {
      issues.push(`Title is only ${titleLength} characters — likely too thin to describe the page.`);
    }
    if (metaLength > META_DESCRIPTION_MAX) {
      issues.push(
        `Meta description is ${metaLength} characters; it will be cut around ${META_DESCRIPTION_MAX}.`,
      );
    }
    if (metaLength < 70) {
      issues.push(
        `Meta description is ${metaLength} characters — short enough that Google may replace it with its own snippet.`,
      );
    }

    const lowered = targetKeyword?.toLowerCase();
    const keywordInTitle = lowered ? title.toLowerCase().includes(lowered) : undefined;
    const keywordInMetaDescription = lowered
      ? metaDescription.toLowerCase().includes(lowered)
      : undefined;

    if (keywordInTitle === false) {
      issues.push(`Target keyword "${targetKeyword}" does not appear in the title.`);
    }
    if (keywordInMetaDescription === false) {
      issues.push(`Target keyword "${targetKeyword}" does not appear in the meta description.`);
    }

    return {
      titleLength,
      metaDescriptionLength: metaLength,
      keywordInTitle,
      keywordInMetaDescription,
      issues,
      caveat:
        'Google truncates by pixel width, not character count, so these thresholds are guidance rather than hard limits.',
    };
  },
});
