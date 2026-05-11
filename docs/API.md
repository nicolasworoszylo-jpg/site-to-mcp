# API Reference

Pełna referencja publicznego API. Wszystko poniżej jest eksportowane z `@vidok/site-to-mcp`.

## Spis treści

- [Factory](#factory)
- [Audit](#audit)
- [Autofix](#autofix)
- [Content extraction](#content-extraction)
- [Schema builder](#schema-builder)
- [AI files generators](#ai-files-generators)
- [MCP server](#mcp-server)
- [Monitoring](#monitoring)
- [Scoring](#scoring)
- [Types](#types)

---

## Factory

### `createSiteToMcp(config) → SiteToMcp`

Stwórz "orchestrator" instance ze wszystkimi metodami.

```ts
import { createSiteToMcp } from '@vidok/site-to-mcp';

const s2m = createSiteToMcp({
  siteUrl: 'https://example.com',
  brand: { name: 'Example', /* ... */ },
});
```

Metody instance:

```ts
s2m.config: SiteToMcpConfig
s2m.pageIndex: PageIndex

s2m.audit(url, opts?): Promise<AuditReport>
s2m.proposeFixes(report): AutofixResult
s2m.applyFixes(report): AutofixResult
s2m.extract(url, html): ExtractedContent
s2m.buildSchema(input): SchemaBundleOutput

s2m.generateLlmsTxt(input?): string
s2m.generateRobotsTxt(input?): string
s2m.generateSitemapXml(entries?): string
s2m.generateRss(input): string
s2m.generateAgentCard(input?): string
s2m.generateHeadersFile(allowTraining?): string
s2m.generateSkillMd(): string
s2m.generateAgentsMd(projectName?): string

s2m.createMCPServer(): MCPServer
s2m.createMonitor(history?): Monitor
```

---

## Audit

### `audit(opts) → Promise<AuditReport>`

Standalone audit (bez factory). Przydatne gdy chcesz tylko audytować, bez konfigurowania wszystkiego.

```ts
import { audit } from '@vidok/site-to-mcp';

const report = await audit({
  url: 'https://example.com/blog/foo',
  config: { /* opcjonalne — z brand info */ },
  testAiBots: true,           // domyślnie true
  pagespeedApiKey: '...',     // opcjonalne
  log: console.log,
});

console.log(report.scores.overall); // 0-100
console.log(report.findings.length);
```

### Klasa `AuditEngine`

Dla zaawansowanych use cases (custom warstwy, integracje):

```ts
import { AuditEngine } from '@vidok/site-to-mcp';

const engine = new AuditEngine({ url, config });
const report = await engine.run();
```

---

## Autofix

### `autofix(opts) → AutofixResult`

Synchronous (nie hits network — pracuje na rawHtml z report'u).

```ts
import { audit, autofix } from '@vidok/site-to-mcp';

const report = await audit({ url, config });
const result = autofix({ report, config, mutate: false, maxRisk: 'low' });

console.log(result.applied);          // co plugin by zrobił
console.log(result.skipped);          // co plugin pominął i dlaczego
console.log(result.filesGenerated);   // pliki do wygenerowania (llms.txt itd.)
console.log(result.diff);             // tekstowy diff (jeśli mutate: true)
```

`maxRisk`:
- `'zero'` — tylko zero-risk (default tylko inject schema, llms.txt, robots.txt)
- `'low'` — + low-risk (wrap article, lang attr)
- `'medium'` — + medium-risk (wrap main — może wpłynąć na layout)
- `'high'` — + high-risk (rzadko — explicit user opt-in)

---

## Content extraction

### `extractContent(opts) → ExtractedContent`

```ts
import { extractContent, estimateTokens } from '@vidok/site-to-mcp';

const content = extractContent({
  url: 'https://example.com/blog/foo',
  html: '<html>...</html>',
});

content.markdown        // czyste markdown
content.headings        // array z isQuestion flag
content.qa              // Q&A pairs
content.stats           // statystyki/liczby
content.quotes          // cytaty
content.tables          // tabele
content.entities        // proper nouns (≥2 occurrences)
content.metrics         // word count, entity density, etc.
content.outboundLinks   // linki zewnętrzne (isAuthoritative flag)

const tokens = estimateTokens(content.markdown, content.lang ?? 'pl');
```

### `ContentExtractor.chunkText(markdown, targetWords) → string[]`

Split na ~150-słowne chunks (research: 50-150 = 2.3x więcej cytowań).

```ts
import { ContentExtractor } from '@vidok/site-to-mcp';
const ext = new ContentExtractor({ url, html });
const chunks = ext.chunkText(content.markdown, 150);
```

---

## Schema builder

### `buildSchemaBundle(input) → SchemaBundleOutput`

```ts
import { buildSchemaBundle } from '@vidok/site-to-mcp';

const bundle = buildSchemaBundle({
  siteUrl: 'https://example.com',
  brand: { name: 'Example', /* ... */ },
  page: {
    type: 'BlogPosting',
    url: 'https://example.com/blog/foo',
    headline: 'How to widget',
    description: 'A guide.',
    image: 'https://example.com/cover.jpg',
    author: { name: 'Jane Doe', /* ... */ },
    datePublished: '2026-05-01',
    speakable: true,
  },
  faq: [
    { question: 'What is widget?', answer: 'A thing.' },
    { question: 'How to use?', answer: 'Press the button.' },
  ],
  breadcrumbs: [
    { name: 'Home', url: 'https://example.com' },
    { name: 'Blog', url: 'https://example.com/blog' },
    { name: 'How to widget', url: 'https://example.com/blog/foo' },
  ],
  speakable: true,
});

bundle.graph       // JSON object (@graph)
bundle.scriptTag   // gotowy <script type="application/ld+json">...</script>
bundle.types       // ['Organization', 'WebSite', 'BreadcrumbList', 'BlogPosting', 'FAQPage', 'Person']
```

### Niskopoziomowe templates

```ts
import {
  organization, website, breadcrumbList,
  article, person, faqPage, product, localBusiness, howTo, qaPage,
  speakableSpecification, service,
  graphBundle, toScriptTag,
} from '@vidok/site-to-mcp';

const org = organization(brand, siteUrl);
const ws = website(siteUrl, 'Example', 'pl-PL');
const graph = graphBundle([org, ws]);
const tag = toScriptTag(graph);
```

Per-type schema obsługuje 14 typów: `Organization`, `WebSite`, `BreadcrumbList`, `Article`, `BlogPosting`, `NewsArticle`, `Person`, `FAQPage`, `Product`, `LocalBusiness`, `HowTo`, `QAPage`, `SpeakableSpecification`, `Service`.

---

## AI files generators

```ts
import {
  generateLlmsTxt, generateLlmsFullTxt,
  generateRobotsTxt, generateSitemapXml, generateRss,
  generateAgentCard, generateHeadersFile,
  generateSkillMd, generateAgentsMd, generateAiTxt,
} from '@vidok/site-to-mcp';
```

### `generateLlmsTxt(input)`

```ts
generateLlmsTxt({
  siteName: 'Example Inc',
  siteDescription: 'Best widgets',
  siteUrl: 'https://example.com',
  sections: [
    {
      title: 'Pages',
      links: [
        { url: 'https://example.com/', title: 'Home' },
        { url: 'https://example.com/about', title: 'About', description: 'Our story' },
      ],
    },
  ],
  optional: { /* same shape */ },
});
```

### `generateRobotsTxt(input)`

```ts
generateRobotsTxt({
  siteUrl: 'https://example.com',
  aiBots: {
    GPTBot: false,
    ClaudeBot: false,
    PerplexityBot: true,
    /* ... */
  },
  sitemapPath: '/sitemap.xml',
  defaultDisallow: ['/admin/', '/private/'],
  disallow: ['/api/internal/'],  // per AI bot
});
```

### `generateSitemapXml(entries)`

```ts
generateSitemapXml([
  {
    loc: 'https://example.com/',
    lastmod: '2026-05-01',
    changefreq: 'weekly',
    priority: 1.0,
    alternates: [
      { lang: 'en', href: 'https://example.com/en/' },
      { lang: 'pl', href: 'https://example.com/' },
    ],
  },
]);
```

### `generateAgentCard(input)`

```ts
generateAgentCard({
  name: 'Example Inc',
  description: 'Best widgets',
  siteUrl: 'https://example.com',
  capabilities: ['list_pages', 'get_page', 'search_pages'],
  endpoints: {
    mcp: 'https://example.com/.well-known/mcp.json',
    llmsTxt: 'https://example.com/llms.txt',
  },
  contact: { email: 'hello@example.com' },
});
```

### `generateHeadersFile(input)`

Format dla Cloudflare/Netlify `_headers`:

```ts
generateHeadersFile({
  paths: [
    {
      pattern: '/blog/*',
      headers: { 'X-Custom-Header': 'value', 'Cache-Control': 'public, max-age=3600' },
    },
  ],
  globalContentSignal: {
    aiTrain: 'no',
    aiSearch: 'yes',
    aiReasoning: 'yes',
  },
});
```

Output:
```
/*
  Content-Signal: ai-train=no, ai-search=yes, ai-reasoning=yes

/blog/*
  X-Custom-Header: value
  Cache-Control: public, max-age=3600
```

---

## MCP server

### `MCPServer`

```ts
import { MCPServer, PageIndex } from '@vidok/site-to-mcp';

const pageIndex = new PageIndex();
pageIndex.add({
  url: 'https://example.com/blog/foo',
  path: '/blog/foo',
  title: 'How to widget',
  tokens: 1240,
  preview: { headings: [{ level: 1, text: 'How to widget' }] },
  full: extractedContent, // lazy ok
});

const mcp = new MCPServer({ config, pageIndex });

// Manifest (do .well-known/mcp.json GET)
const manifest = mcp.manifest();

// Handle JSON-RPC (do .well-known/mcp.json POST)
const result = await mcp.handle({
  jsonrpc: '2.0',
  id: 1,
  method: 'tools/call',
  params: { name: 'get_page', arguments: { path: '/blog/foo' } },
});
```

### Content negotiation utilities

```ts
import { detectAiBot, shouldServeMarkdown, htmlToMarkdownResponse } from '@vidok/site-to-mcp';

// Wykryj AI bot z User-Agent
const { isBot, bot } = detectAiBot(request.headers.get('user-agent'));

// Decyzja czy serwować markdown
const shouldMd = shouldServeMarkdown({
  pathname: '/blog/foo',
  accept: 'text/markdown',
  userAgent: 'Mozilla/5.0 ... GPTBot/1.0',
  query: new URLSearchParams({ format: 'md' }),
});

// Konwersja
const md = htmlToMarkdownResponse(html, 'https://example.com/blog/foo', 'pl-PL');
// md.body — markdown z headerem ai-meta
// md.headers — { 'Content-Type': 'text/markdown', 'X-AI-Tokens': '1240', ... }
```

---

## Monitoring

### `Monitor`

```ts
import { Monitor } from '@vidok/site-to-mcp';

const monitor = new Monitor({
  config: {
    siteUrl, brand,
    monitoring: {
      enabled: true,
      prompts: [
        {
          id: 'p1',
          prompt: 'najlepsze widgety w Polsce',
          language: 'pl',
          brand: 'Example Inc',
          competitors: ['Competitor A', 'Competitor B'],
        },
      ],
      engines: ['chatgpt', 'perplexity', 'claude', 'gemini'],
      apiKeys: {
        openai: process.env.OPENAI_API_KEY,
        anthropic: process.env.ANTHROPIC_API_KEY,
        perplexity: process.env.PERPLEXITY_API_KEY,
        google: process.env.GOOGLE_API_KEY,
      },
    },
  },
  history: previousChecks, // opcjonalne — do delta tygodniowego
});

const checks = await monitor.run();

const report = monitor.generateReport(
  checks,
  '2026-05-01T00:00:00Z',
  '2026-05-08T00:00:00Z',
);

const markdown = monitor.reportToMarkdown(report);
// Wyślij na Slack/email/Notion
```

---

## Scoring

```ts
import { computeOverallScore, scoreLetter } from '@vidok/site-to-mcp';

const score = computeOverallScore(report);

score.overall        // 0-100
score.letter         // 'A+' | 'A' | 'B' | 'C' | 'D' | 'F'
score.category       // 'ready' | 'needs_work' | 'not_ready'
score.failed         // Finding[] (status === 'fail')
score.warnings       // Finding[] (status === 'warning')
score.passed         // Finding[] (status === 'pass')
score.recommendations // top 10 by impact

const letter = scoreLetter(87); // 'A'
```

---

## Types

Wszystkie typy: `src/types/index.ts`. Najważniejsze:

```ts
// Audit
interface AuditReport {
  url: string;
  timestamp: string;
  scores: Record<AuditLayer | 'overall', number>;
  findings: Finding[];
  meta: { ... };
  rawHtml?: string;
}

interface Finding {
  id: string;
  layer: AuditLayer;
  status: 'pass' | 'fail' | 'warning' | 'skip';
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  title: string;
  detail: string;
  autofixable: boolean;
  autofix?: { action: string; args: Record<string, unknown>; risk: 'zero' | 'low' | 'medium' | 'high' };
  citation?: string;
  impact?: number;
}

// Config
interface SiteToMcpConfig {
  siteUrl: string;
  brand: { name: string; description?: string; logo?: string; sameAs?: string[]; contact?: {...}; primaryAuthor?: {...} };
  aiBots: Record<BotName, boolean>;
  mcp?: { enabled: boolean; path: string; rateLimitPerMin: number; requireAuth: boolean; authToken?: string };
  llmsTxt?: { enabled: boolean; path: string; fullPath: string; sections?: LlmsTxtSection[] };
  monitoring?: { enabled: boolean; prompts: PromptTest[]; engines: EngineName[]; apiKeys?: {...} };
  autofix?: { mutate: boolean; allowed: AutofixAction['type'][]; maxRisk: 'zero' | 'low' | 'medium' | 'high' };
}
```

Pełne definicje: zobacz [`src/types/index.ts`](../src/types/index.ts).
