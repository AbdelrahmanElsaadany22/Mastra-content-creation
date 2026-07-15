
import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';
import { LibSQLStore } from '@mastra/libsql';
import { DuckDBStore } from "@mastra/duckdb";
import { MastraCompositeStore } from '@mastra/core/storage';
import { Observability, MastraStorageExporter, MastraPlatformExporter, SensitiveDataFilter } from '@mastra/observability';
import { linkedinAgent } from './agents/LinkedInAgent';
import { twitterAgent } from './agents/TwitterAgent';
import { instagramAgent } from './agents/InstagramAgent';
import { facebookAgent } from './agents/FacebookAgent';
import { articlesAgent } from './agents/ArticlesAgent';
import { validateLinkedInPost, formatLinkedInText } from './tools/linkedin-post-tools';
import { validateTweet, splitIntoThread } from './tools/twitter-tools';
import { validateInstagramCaption } from './tools/instagram-tools';
import { validateFacebookPost } from './tools/facebook-tools';
import { analyzeArticleStructure, checkSeoMetadata } from './tools/article-tools';
import { searchWeb, findRecentDiscussion } from './tools/research-tools';

export const mastra = new Mastra({
  agents: { linkedinAgent, twitterAgent, instagramAgent, facebookAgent, articlesAgent },
  tools: {
    validateLinkedInPost,
    formatLinkedInText,
    validateTweet,
    splitIntoThread,
    validateInstagramCaption,
    validateFacebookPost,
    analyzeArticleStructure,
    checkSeoMetadata,
    searchWeb,
    findRecentDiscussion,
  },
  storage: new MastraCompositeStore({
    id: 'composite-storage',
    default: new LibSQLStore({
      id: "mastra-storage",
      url: "file:./mastra.db",
    }),
    domains: {
      observability: await new DuckDBStore().getStore('observability'),
    }
  }),
  logger: new PinoLogger({
    name: 'Mastra',
    level: 'info',
  }),
  observability: new Observability({
    configs: {
      default: {
        serviceName: 'mastra',
        exporters: [
          new MastraStorageExporter(), // Persists observability events to Mastra Storage
          new MastraPlatformExporter(), // Sends observability events to Mastra Platform (if MASTRA_PLATFORM_ACCESS_TOKEN is set)
        ],
        spanOutputProcessors: [
          new SensitiveDataFilter(), // Redacts sensitive data like passwords, tokens, keys
        ],
      },
    },
  }),
});
