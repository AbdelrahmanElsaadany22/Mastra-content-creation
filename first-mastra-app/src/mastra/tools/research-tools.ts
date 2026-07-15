import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

const TAVILY_ENDPOINT = 'https://api.tavily.com/search';

const resultSchema = z.object({
  title: z.string(),
  url: z.string(),
  content: z.string().describe('Extract of the page, usable as a source'),
  publishedDate: z.string().optional().describe('Only present for news results'),
});

type TavilyResult = {
  title?: string;
  url?: string;
  content?: string;
  published_date?: string;
};

type TavilyBody = {
  query: string;
  max_results: number;
  search_depth: 'basic' | 'advanced';
  topic?: 'general' | 'news';
  time_range?: 'day' | 'week' | 'month' | 'year';
  include_answer?: boolean;
};

/**
 * Fails loudly rather than returning nothing: an empty result set is indistinguishable from
 * "no such topic" to the model, which invites it to fill the gap with invented facts.
 */
async function tavilySearch(body: TavilyBody, abortSignal?: AbortSignal) {
  const apiKey = process.env.TAVILY_API_KEY;

  if (!apiKey) {
    throw new Error(
      'TAVILY_API_KEY is not set. Add it to .env (get a free key at https://app.tavily.com). ' +
        'Search is unavailable until then — do not answer from memory.',
    );
  }

  const response = await fetch(TAVILY_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal: abortSignal,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(
      `Tavily search failed (${response.status} ${response.statusText}). ${detail.slice(0, 300)}`,
    );
  }

  const data = (await response.json()) as { results?: TavilyResult[]; answer?: string };

  const results = (data.results ?? []).flatMap(r =>
    r.url && r.title
      ? [
          {
            title: r.title,
            url: r.url,
            content: r.content ?? '',
            ...(r.published_date ? { publishedDate: r.published_date } : {}),
          },
        ]
      : [],
  );

  return { results, answer: data.answer };
}

export const searchWeb = createTool({
  id: 'search-web',
  description:
    'Search the live web for facts, statistics, articles, or background on a topic. Use this to ground any factual claim, number, or reference before it goes into a post. Returns real sources with URLs.',
  inputSchema: z.object({
    query: z.string().describe('A focused search query, not a whole sentence'),
    maxResults: z.number().int().min(1).max(10).default(5),
  }),
  outputSchema: z.object({
    results: z.array(resultSchema),
    answer: z.string().optional().describe('Tavily summary across sources; verify against results'),
    resultCount: z.number(),
  }),
  execute: async ({ query, maxResults }, context) => {
    const { results, answer } = await tavilySearch(
      {
        query,
        max_results: maxResults,
        search_depth: 'advanced',
        include_answer: true,
      },
      context?.abortSignal,
    );

    return { results, answer, resultCount: results.length };
  },
});

export const findRecentDiscussion = createTool({
  id: 'find-recent-discussion',
  description:
    'Find what has actually been published about a topic recently, filtered by time window. Use to ground a post in current events or to check whether an angle is already saturated. NOTE: this reports recent news coverage — it is NOT LinkedIn trending data, which no public API exposes. Never present these results as "trending on LinkedIn".',
  inputSchema: z.object({
    topic: z.string().describe('The subject to look for recent coverage of'),
    timeRange: z
      .enum(['day', 'week', 'month'])
      .default('week')
      .describe('How far back to look'),
    maxResults: z.number().int().min(1).max(10).default(8),
  }),
  outputSchema: z.object({
    results: z.array(resultSchema),
    resultCount: z.number(),
    timeRange: z.string(),
    caveat: z.string(),
  }),
  execute: async ({ topic, timeRange, maxResults }, context) => {
    const { results } = await tavilySearch(
      {
        query: topic,
        max_results: maxResults,
        search_depth: 'basic',
        topic: 'news',
        time_range: timeRange,
      },
      context?.abortSignal,
    );

    return {
      results,
      resultCount: results.length,
      timeRange,
      caveat:
        'Recent news coverage, not LinkedIn engagement or trending data. Cite these as articles, not as evidence of what is popular on LinkedIn.',
    };
  },
});
