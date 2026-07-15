import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import {
  countChars,
  countEmoji,
  extractHashtags,
  extractMentions,
  extractUrls,
  foldPreview,
  isCutMidThought,
} from './text-utils';

const MAX_CAPTION_LENGTH = 2200;
const MORE_CUTOFF = 125;
const MAX_HASHTAGS = 30;

export const validateInstagramCaption = createTool({
  id: 'validate-instagram-caption',
  description:
    'Check an Instagram caption against real limits: 2,200 characters total, the 125-character "... more" fold, and the 30-hashtag cap. Run on every caption before showing it to the user.',
  inputSchema: z.object({
    caption: z.string().describe('The full caption, exactly as it would be posted'),
  }),
  outputSchema: z.object({
    characterCount: z.number(),
    charactersRemaining: z.number(),
    withinLimit: z.boolean(),
    visibleBeforeMore: z.string().describe('What shows in feed before "... more"'),
    hookCutMidThought: z.boolean(),
    hashtags: z.array(z.string()),
    hashtagCount: z.number(),
    mentions: z.array(z.string()),
    emojiCount: z.number(),
    issues: z.array(z.string()),
  }),
  execute: async ({ caption }) => {
    const characterCount = countChars(caption);
    const hashtags = extractHashtags(caption);
    const mentions = extractMentions(caption);
    const links = extractUrls(caption);
    const emojiCount = countEmoji(caption);
    const issues: string[] = [];

    if (characterCount > MAX_CAPTION_LENGTH) {
      issues.push(
        `Caption is ${characterCount} characters, ${characterCount - MAX_CAPTION_LENGTH} over the ${MAX_CAPTION_LENGTH} limit.`,
      );
    }
    if (hashtags.length > MAX_HASHTAGS) {
      issues.push(
        `${hashtags.length} hashtags exceeds Instagram's hard cap of ${MAX_HASHTAGS}; the post will be rejected.`,
      );
    } else if (hashtags.length > 10) {
      issues.push(
        `${hashtags.length} hashtags. Instagram's own guidance is 3-5; large blocks read as spam.`,
      );
    }
    if (isCutMidThought(caption, MORE_CUTOFF)) {
      issues.push(
        'Nothing resolves in the first 125 characters, so the visible part is cut mid-thought. Land the hook before the fold.',
      );
    }
    if (links.length > 0) {
      issues.push(
        'Links in captions are not clickable on Instagram. Move it to the bio or a story and say "link in bio".',
      );
    }

    return {
      characterCount,
      charactersRemaining: MAX_CAPTION_LENGTH - characterCount,
      withinLimit: characterCount <= MAX_CAPTION_LENGTH,
      visibleBeforeMore: foldPreview(caption, MORE_CUTOFF),
      hookCutMidThought: isCutMidThought(caption, MORE_CUTOFF),
      hashtags,
      hashtagCount: hashtags.length,
      mentions,
      emojiCount,
      issues,
    };
  },
});
