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

const MAX_POST_LENGTH = 63206;
const DESKTOP_FOLD = 477;
const MOBILE_FOLD = 125;

export const validateFacebookPost = createTool({
  id: 'validate-facebook-post',
  description:
    'Check a Facebook post: the 63,206-character limit, and what survives the "See more" fold on mobile (~125 chars) and desktop (~477 chars). Run on every draft.',
  inputSchema: z.object({
    post: z.string().describe('The full post text, exactly as it would be published'),
  }),
  outputSchema: z.object({
    characterCount: z.number(),
    withinLimit: z.boolean(),
    visibleOnMobile: z.string().describe('Approximate text shown before "See more" on mobile'),
    visibleOnDesktop: z.string(),
    cutMidThoughtOnMobile: z.boolean(),
    hashtags: z.array(z.string()),
    linkCount: z.number(),
    issues: z.array(z.string()),
    foldCaveat: z.string(),
  }),
  execute: async ({ post }) => {
    const characterCount = countChars(post);
    const hashtags = extractHashtags(post);
    const links = extractUrls(post);
    const issues: string[] = [];

    if (characterCount > MAX_POST_LENGTH) {
      issues.push(`Post is ${characterCount} characters, over the ${MAX_POST_LENGTH} limit.`);
    }
    if (isCutMidThought(post, MOBILE_FOLD)) {
      issues.push(
        'Nothing resolves in the first ~125 characters, where mobile cuts to "See more". Most Facebook traffic is mobile — land the hook there.',
      );
    }
    if (MARKDOWN_PATTERN.test(post)) {
      issues.push('Contains markdown; Facebook renders it literally. Use plain text.');
    }
    if (hashtags.length > 3) {
      issues.push(
        `${hashtags.length} hashtags. Hashtags do little on Facebook and a block of them looks like spam.`,
      );
    }
    if (characterCount > 500) {
      issues.push(
        `${characterCount} characters. Facebook engagement drops off well before this; consider whether the idea needs the length.`,
      );
    }

    return {
      characterCount,
      withinLimit: characterCount <= MAX_POST_LENGTH,
      visibleOnMobile: foldPreview(post, MOBILE_FOLD),
      visibleOnDesktop: foldPreview(post, DESKTOP_FOLD),
      cutMidThoughtOnMobile: isCutMidThought(post, MOBILE_FOLD),
      hashtags,
      linkCount: links.length,
      issues,
      foldCaveat:
        'Facebook decides the fold by rendered line count, not exact characters, so these cutoffs are approximate and shift with screen width and font size.',
    };
  },
});
