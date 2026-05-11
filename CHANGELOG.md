# Changelog

Wszystkie istotne zmiany w projekcie.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] — 2026-05-11

### Added

#### Core
- **AuditEngine** — 6-warstwowy auditor (indexability, schema, semantic_html, content, ai_files, performance). Każdy finding ma severity, citation, autofix-ref.
- **Autofixer** — 12+ fixerów. Iron law: zero destruktywnych zmian. Risk gate z `maxRisk` config.
- **ContentExtractor** — HTML → markdown przez Turndown. Wyciąga Q&A pairs (z FAQPage schema albo H3-question pattern), stats, quotes, tables, entities. Plus `estimateTokens()` + `chunkText()`.
- **Schema builder** — 14 typów Schema.org (Organization, WebSite, BreadcrumbList, Article/BlogPosting/NewsArticle, Person, FAQPage, Product, LocalBusiness, HowTo, Service, QAPage, SpeakableSpecification). `@graph` bundling. XSS-safe `<script>` serialization.
- **AI files generators** — `llms.txt`, `llms-full.txt` (cap 28k tokens), `robots.txt` z 6 AI bots split (search vs training), `sitemap.xml` z hreflang, `feed.xml`, `/.well-known/agent-card.json` (A2A spec), `_headers` z `Content-Signal`, `skill.md` (Osmani layer 3), `AGENTS.md` (ETH Zurich March 2026 — skeleton, human fill only), eksperymentalny `ai.txt`.
- **MCP server** — MCP-over-HTTP, 6 tools: `list_pages`, `get_page`, `search_pages`, `get_schema`, `get_faq`, `get_brand`. JSON-RPC 2.0. PageIndex z lekkim full-text search.
- **Content negotiation** — `detectAiBot()` (15 patterns: GPTBot/ChatGPT-User/OAI-SearchBot/ClaudeBot/Claude-SearchBot/Claude-User/PerplexityBot/Google-Extended/AppleBot-Extended/Bytespider/CCBot/YouBot/Meta-ExternalAgent + IDE: axios/curl/got/colly). `shouldServeMarkdown()` (4 sygnały). `htmlToMarkdownResponse()` z `X-AI-Tokens`, `X-AI-Source-URL`, `Vary` headers.
- **Monitoring** — citation tracker dla ChatGPT (gpt-4o-search-preview), Perplexity (sonar-pro), Claude (sonnet-4-7), Gemini (1.5-pro). Sentiment heuristic. Weekly report w markdown.
- **Scoring** — A-F grade + category (ready/needs_work/not_ready). Top 10 recommendations by impact.

#### Adapters
- **Next.js** — `siteToMcpMiddleware`, route handlers (`createMcpRoute`, `createLlmsTxtRoute`, `createRobotsRoute`, `createSitemapRoute`, `createAgentCardRoute`), `next.config.mjs` wrapper (`withSiteToMcp`).
- **Express** — `siteToMcpRouter()`, mountable na każdej ścieżce.
- **Astro** — integration z `astro:build:done` hook. Opcjonalne `.md` companions per page.
- **WordPress** — self-contained PHP plugin. Zero JS deps. Admin UI dla AI bots policy. Custom rewrite rules dla /llms.txt, /skill.md, /.well-known/*.
- **Vanilla** — `createWorkerHandler` (Cloudflare/Vercel Edge), `BROWSER_SCRIPT` (CDN tag z Copy for AI button + meta injection).

#### CLI
- `site-to-mcp init` — interactive setup → s2m.config.json
- `site-to-mcp audit <url> [--threshold N] [--json]` — CI-friendly z exit code 2
- `site-to-mcp fix <url> [--apply]`
- `site-to-mcp generate llms.txt|robots.txt|sitemap.xml|agent-card.json|skill.md|AGENTS.md|_headers [--out path]`
- `site-to-mcp serve [--port 3030]` — local dev server
- `site-to-mcp monitor [--out report.md]`

#### Docs
- `README.md` — overview + filozofia + quick start (Next.js)
- `docs/INSTALLATION.md` — per-framework guide (Next.js, Express, Astro, WordPress, Workers, Vanilla)
- `docs/ARCHITECTURE.md` — module breakdown + data flow + ADRs
- `docs/API.md` — pełna referencja
- `examples/nextjs-demo/` — zaproszeniaonline.com config + middleware + routes

#### Templates
- 6 schema templates JSON (Tier 1/2/3): Organization, WebSite, Article, FAQPage, BreadcrumbList, QAPage

### Methodology base

Plugin built on:
- 16 zwalidowanych tez z `memory/seo_llm_geo_aeo.md` (kwiecień 2026, 3+ źródła per teza)
- 10 plików operacyjnej metodologii w `~/Desktop/Claude/SEO-LLM-2026/`
- Research May 2026 (web-analizator): Addy Osmani "Agentic Engine Optimization" framework (Google Cloud AI), Conductor State of AEO/GEO 2026 (17M responses, 100M citations), Indig 30M citation study, NeurIPS 2025 C-SEO Bench, ETH Zurich AGENTS.md value review (March 2026)
- Adopted patterns from: `aeo.js` (multivmlabs), `agentic-seo` (Osmani), `next-geo` (Continue.dev), `agentmarkup`
