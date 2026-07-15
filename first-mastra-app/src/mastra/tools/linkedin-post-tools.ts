import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

import {
  countChars,
  extractHashtags,
  extractUrls,
  foldPreview,
  isCutMidThought,
  MARKDOWN_PATTERN,
} from './text-utils';

const MAX_POST_LENGTH = 3000;
const SEE_MORE_CUTOFF = 210;

export const validateLinkedInPost = createTool({
  id: 'validate-linkedin-post',
  description:
    'Check a drafted LinkedIn post against platform limits: total length, what survives the "see more" fold, hashtag count, markdown that LinkedIn will not render, and link placement. Run this on every draft before showing it to the user.',
  inputSchema: z.object({
    post: z.string().describe('The full post text, exactly as it would be published'),
  }),
  outputSchema: z.object({
    characterCount: z.number(),
    charactersRemaining: z.number(),
    withinLimit: z.boolean(),
    hookText: z.string().describe('The text visible before the "see more" fold'),
    hookCutMidThought: z
      .boolean()
      .describe('True when no sentence or line ends before the fold, so the hook is cut mid-thought'),
    hashtags: z.array(z.string()),
    hashtagCount: z.number(),
    linkCount: z.number(),
    hasUnrenderedMarkdown: z.boolean(),
    issues: z.array(z.string()).describe('Problems to fix before publishing'),
  }),
  execute: async ({ post }) => {
    const characterCount = countChars(post);
    const hookText = foldPreview(post, SEE_MORE_CUTOFF);
    const hashtags = extractHashtags(post);
    const links = extractUrls(post);
    const markdownArtifacts = MARKDOWN_PATTERN.test(post);
    const hookCutMidThought = isCutMidThought(post, SEE_MORE_CUTOFF);

    const issues: string[] = [];

    if (characterCount > MAX_POST_LENGTH) {
      issues.push(
        `Post is ${characterCount} characters, ${characterCount - MAX_POST_LENGTH} over LinkedIn's ${MAX_POST_LENGTH} limit.`,
      );
    }
    if (markdownArtifacts) {
      issues.push(
        'Contains markdown (**, ##, or [](); LinkedIn renders these literally. Run format-linkedin-text to strip it.',
      );
    }
    if (hashtags.length > 5) {
      issues.push(`${hashtags.length} hashtags; 3-5 reads as intentional rather than spammy.`);
    } else if (hashtags.length < 3) {
      issues.push(
        `${hashtags.length} hashtags; 3-5 relevant ones help reach beyond existing followers.`,
      );
    }
    if (hookCutMidThought) {
      issues.push(
        'Nothing resolves before the "see more" fold, so the hook is cut mid-thought. Land a complete thought in the first ~210 characters.',
      );
    }
    const firstLink = links[0];
    if (firstLink !== undefined && post.indexOf(firstLink) < post.length / 2) {
      issues.push(
        'A link appears early in the post. LinkedIn suppresses reach on posts with outbound links; move it to the comments or the final line.',
      );
    }

    return {
      characterCount,
      charactersRemaining: MAX_POST_LENGTH - characterCount,
      withinLimit: characterCount <= MAX_POST_LENGTH,
      hookText,
      hookCutMidThought,
      hashtags,
      hashtagCount: hashtags.length,
      linkCount: links.length,
      hasUnrenderedMarkdown: markdownArtifacts,
      issues,
    };
  },
});

export const formatLinkedInText = createTool({
  id: 'format-linkedin-text',
  description:
    'Strip markdown syntax that LinkedIn does not render and normalise spacing into the single-line-break style the feed displays well. Use whenever a draft contains **bold**, headings, markdown links, or markdown bullets.',
  inputSchema: z.object({
    text: z.string().describe('Draft text that may contain markdown'),
  }),
  outputSchema: z.object({
    formatted: z.string(),
    changes: z.array(z.string()).describe('What was rewritten'),
  }),
  execute: async ({ text }) => {
    const changes: string[] = [];
    let formatted = text;

    const record = (pattern: RegExp, replacement: string, note: string) => {
      const next = formatted.replace(pattern, replacement);
      if (next !== formatted) {
        formatted = next;
        changes.push(note);
      }
    };

    record(/^#{1,6}\s+(.+)$/gm, '$1', 'Removed markdown headings (LinkedIn has no heading styles).');
    record(/\[([^\]]+)\]\(([^)]+)\)/g, '$1: $2', 'Expanded markdown links to plain "text: url".');
    record(/\*\*([^*]+)\*\*/g, '$1', 'Removed ** bold markers.');
    record(/(?<![*\w])\*([^*\n]+)\*(?!\w)/g, '$1', 'Removed * italic markers.');
    record(/^\s*[-*+]\s+/gm, '• ', 'Converted markdown bullets to • characters.');
    record(/`([^`]+)`/g, '$1', 'Removed inline code backticks.');
    record(/\n{3,}/g, '\n\n', 'Collapsed runs of blank lines to a single blank line.');

    formatted = formatted.trim();

    return { formatted, changes };
  },
});
