# Social Content Agents

Five [Mastra](https://mastra.ai/) agents that write **text content** for social platforms and blogs.
Each agent knows one platform's real constraints and writes only for that platform.

These agents write copy. They do not design images, build carousels, script video, schedule, or
publish anything.

## Prerequisites

| Requirement | Notes |
| --- | --- |
| Node.js >= 22.13.0 | Set in `package.json` `engines`. Check with `node --version`. |
| An OpenAI API key | All five agents use `openai/gpt-5-mini`. |
| A Tavily API key | Free tier at [app.tavily.com](https://app.tavily.com). Powers the search tools. |

## Setup

```shell
npm install
cp .env.example .env    # then fill in the keys
npm run dev
```

Open [http://localhost:4111](http://localhost:4111) for [Mastra Studio](https://mastra.ai/docs/studio/overview),
where you can talk to each agent, inspect tool calls, and read traces.

Environment variables:

```shell
OPENAI_API_KEY=...      # required — the model for every agent
TAVILY_API_KEY=tvly-... # required — search-web and find-recent-discussion
```

Without `TAVILY_API_KEY` the eight writing and validation tools still work, but the two search
tools throw. That is deliberate — see [Design decisions](#design-decisions).

## The agents

| Agent | ID | Writes | Platform-specific tools |
| --- | --- | --- | --- |
| LinkedIn Content Agent | `linkedin-agent` | Posts, hooks, CTAs, hashtags | `validate-linkedin-post`, `format-linkedin-text` |
| X (Twitter) Content Agent | `twitter-agent` | Tweets, threads, replies | `validate-tweet`, `split-into-thread` |
| Instagram Caption Agent | `instagram-agent` | Captions, hooks, hashtag sets | `validate-instagram-caption` |
| Facebook Content Agent | `facebook-agent` | Post copy for pages, groups, profiles | `validate-facebook-post` |
| Article & Blog Content Agent | `articles-agent` | Long-form markdown, SEO title + meta | `analyze-article-structure`, `check-seo-metadata` |

All five also get `search-web` and `find-recent-discussion`.

Each agent's `instructions` encode that platform's craft rules, not generic advice. The rules
genuinely conflict across platforms — X wants at most one hashtag because they cost reach, while
Instagram takes 3-5. That conflict is why these are five agents and not one with a `platform`
parameter.

Use an agent from code by its ID:

```ts
import { mastra } from './src/mastra/index.ts'

const agent = mastra.getAgentById('twitter-agent')
const res = await agent.generate('Write a tweet about our 45min -> 4min deploy time win')
console.log(res.text)
```

## The tools

Every tool does something a language model gets **wrong** on its own. There is no tool here that
just asks the model to think harder.

### Validators — exact measurement

Models cannot count characters reliably, so they guess, and the guess is wrong. Each validator
returns exact counts plus an `issues` array of concrete problems.

- **`validate-linkedin-post`** — 3,000 char limit, the ~210-char "see more" fold, hashtag count,
  markdown leakage, link placement.
- **`validate-tweet`** — X's real weighted count (see below), hashtag count, accidental-reply
  detection.
- **`validate-instagram-caption`** — 2,200 char limit, the 125-char "... more" fold, the 30-hashtag
  hard cap, non-clickable links.
- **`validate-facebook-post`** — 63,206 char limit, mobile (~125) and desktop (~477) folds.
- **`analyze-article-structure`** — word count, reading time, heading hierarchy, overlong paragraphs.
- **`check-seo-metadata`** — title and meta description lengths, target keyword presence.

All of them share one non-obvious check: **does a complete thought land before the fold?** The
question is not whether the text stops on a sentence boundary at exactly character 210 — it is
whether a sentence ends *anywhere* inside the visible window. A post whose hook resolves at
character 40 is fine; one that runs 210 unbroken characters is not.

### `validate-tweet` and X's weighted counting

X does not count characters. It counts weight, per
[twitter-text config v3](https://github.com/twitter/twitter-text/blob/master/config/v3.json),
which `twitter-tools.ts` implements:

| Input | Cost | Why |
| --- | --- | --- |
| Latin, Arabic, Cyrillic (code point <= 4351) | 1 | Weight 100 at scale 100 |
| CJK, and everything above 4351 | 2 | Default weight 200 |
| Any emoji, including ZWJ sequences like 👨‍👩‍👧‍👦 | 2 | One unit, not one per component |
| Any URL, any length | 23 | X rewrites every link to t.co |

So a 200-character URL costs 23, and a full Arabic tweet gets all 280 characters. A naive
`.length` is wrong in both directions. The tool reports `plainCharacterCount` alongside
`weightedLength` to make the gap visible.

### `split-into-thread`

Splits long text into tweets that each fit 280 weighted, breaking on sentence and paragraph
boundaries rather than mid-word. Falls back to word-level splitting for a single sentence longer
than a tweet. Numbering suffixes (`1/5`) are accounted for in the budget, which takes two passes
since the suffix width depends on the total. A single tweet gets no `1/1`.

It packs greedily and does not know where an argument turns, so the agent is instructed to read
the output and fix breaks that land badly.

### `format-linkedin-text`

Strips markdown that LinkedIn renders literally — `**bold**`, headings, markdown links and
bullets — and reports what it changed.

### Research — `search-web` and `find-recent-discussion`

Both call [Tavily](https://tavily.com). `search-web` grounds factual claims in real sources.
`find-recent-discussion` filters by time window (`day` / `week` / `month`) for posts tied to
current events.

> **`find-recent-discussion` returns recent news coverage. It is NOT trending data.**
> No public API exposes LinkedIn, X, Instagram, or Facebook trending topics or engagement
> figures. A tool claiming to know them would be inventing them. The tool description, a
> `caveat` field on every response, and all five agents' instructions say so, so its results
> never get passed off as engagement data.

## Design decisions

**Search tools throw instead of returning nothing.** When `TAVILY_API_KEY` is missing or the API
fails, both tools raise an error whose message tells the model not to answer from memory. An
empty result set would be indistinguishable from "no such topic," which invites the model to
backfill the gap with an invented statistic. Failing loudly is the whole point.

**No tool fabricates data.** The obvious "trending hashtags" tool was deliberately not built:
without a real data source it would return plausible fiction, which is worse than not existing.

**Honesty rules in every agent.** No invented statistics, studies, client results, or personal
anecdotes. When a post needs a number, the agent searches for it; if search finds nothing, it
drops the claim or leaves a marked `[placeholder]`. Writing it from memory is not an option.
Personal stories cannot be searched, so the agent asks the user or marks a placeholder — a
caption written in the user's voice about something that never happened puts a lie in their mouth.

**Accessibility over growth hacks.** Unicode "bold" characters (𝗹𝗶𝗸𝗲 𝘁𝗵𝗶𝘀) are a common trick for
faking formatting on LinkedIn. Screen readers cannot read them, so the agent is forbidden from
using them.

**Approximations are labelled.** Facebook decides its fold by rendered line count and Google
truncates by pixel width — neither is a character count. Those tools return a `caveat` field
rather than pretending to a precision they do not have.

## Project structure

```
src/mastra/
├── index.ts                    # Mastra instance — all agents and tools registered here
├── agents/
│   ├── LinkedInAgent.ts
│   ├── TwitterAgent.ts
│   ├── InstagramAgent.ts
│   ├── FacebookAgent.ts
│   └── ArticlesAgent.ts
└── tools/
    ├── text-utils.ts           # shared measurement — counting, folds, hashtags, graphemes
    ├── research-tools.ts       # search-web, find-recent-discussion (shared by all agents)
    ├── linkedin-post-tools.ts
    ├── twitter-tools.ts        # includes X's weighted-length implementation
    ├── instagram-tools.ts
    ├── facebook-tools.ts
    └── article-tools.ts
```

`text-utils.ts` holds the measurement logic every validator needs — code-point character counting
(so emoji count as one), fold analysis, hashtag/URL/mention extraction, and grapheme segmentation.
Platform tools import from it rather than each re-implementing the same regex.

Per `AGENTS.md`, every agent and tool must be registered in `src/mastra/index.ts`.

## Platform limits reference

| Platform | Max length | Fold ("see more") | Hashtags |
| --- | --- | --- | --- |
| LinkedIn | 3,000 | ~210 | 3-5 |
| X | 280 (weighted) | — | 0-1 |
| Instagram | 2,200 | 125 | 3-5 (hard cap 30) |
| Facebook | 63,206 | ~125 mobile / ~477 desktop | 0-3 |
| Article (SEO) | — | Title ~60, meta ~155 | — |

Sources: [twitter-text v3](https://github.com/twitter/twitter-text/blob/master/config/v3.json),
[Instagram limits](https://bundle.social/blog/instagram-character-limits-guide),
[Facebook limits](https://typecount.com/blog/facebook-post-character-limit-2026).

Platforms change these. When they do, the constants live at the top of each tool file.

## Known limitations

- **Platform limits drift.** Every number above was verified against a source at the time of
  writing, but LinkedIn and Facebook in particular change their folds without announcement.
- **Fold cutoffs are approximate** on Facebook (rendered lines, not characters) and for SEO
  (pixel width, not characters).
- **`find-recent-discussion` is news, not trends.** Repeated because it is the easiest thing here
  to misuse.
- **No automated tests.** `npm test` is still the placeholder. Tool logic was verified manually
  against known cases; there is no regression suite.
- **Search costs credits.** Every `search-web` call spends Tavily credits and adds latency. The
  agents are told to search only when a post rests on a fact.

## Adding an agent for another platform

1. Verify that platform's real limits against a current source. Do not write them from memory.
2. Add `src/mastra/tools/<platform>-tools.ts` with a validator built on `text-utils.ts` helpers.
   Only build a tool if it does something the model cannot do reliably itself.
3. Add `src/mastra/agents/<Platform>Agent.ts`. Write instructions for *that* platform's craft —
   do not copy another agent's rules. Include the honesty section.
4. Register both in `src/mastra/index.ts`.
5. Check it loads: the agent should appear in Studio with its tools attached.

## Learn more

- [Mastra documentation](https://mastra.ai/docs/)
- [Agents overview](https://mastra.ai/docs/agents/overview) · [Tools](https://mastra.ai/docs/agents/using-tools) · [Memory](https://mastra.ai/docs/memory/overview)
