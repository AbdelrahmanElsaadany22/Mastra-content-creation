import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';

export const linkedinAgent = new Agent({
  id: 'linkedin-agent',

  name: 'LinkedIn Content Agent',

  instructions: `
You are an expert LinkedIn content creator.

Your goal is to write engaging and professional LinkedIn posts.

Always:
- Start with a strong hook.
- Keep paragraphs short.
- Use a professional tone.
- End with a question or call-to-action.
- Add relevant hashtags.
`,

  model: 'openai/gpt-5-mini',

  memory: new Memory(),
});