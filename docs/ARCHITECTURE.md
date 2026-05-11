# Architecture

Dokumentacja dla developerów którzy chcą rozumieć **jak** plugin jest zbudowany — albo go contributować, albo zaadaptować do własnego framework'a.

## Filozofia projektowa

Plugin egzekwuje 4 zasady:

1. **Core jest runtime-agnostic.** Każdy moduł `core/*` działa w Node, Bun, Deno, Cloudflare Workers, Vercel Edge — bez node-specific API w hot path. Tylko jeden moduł (Astro adapter) dotyka `node:fs` i to świadomie (build-time only).
2. **Adaptery są thin.** Każdy adapter to wrapper na core. Cała logika żyje w `core/`. Adapter ma tylko 200-500 linii kodu (binding).
3. **Public API jest stable.** Funkcje eksportowane z `@vidok/site-to-mcp` (i sub-paths) nie zmieniają sygnatur między minor versions. Typy są w `src/types/index.ts` — jedno źródło prawdy.
4. **Iron law: zero destruktywnych zmian.** Autofixer nigdy nie usuwa, nigdy nie nadpisuje treści, nigdy nie zmienia design. Dodaje schema, naprawia robots, wraps content. To wszystko.

## Wysokopoziomowy diagram

```
                       ┌──────────────────────┐
                       │   User config        │
                       │  (s2m.config.json)   │
                       └────────────┬─────────┘
                                    │
                                    ▼
                  ┌─────────────────────────────────────┐
                  │           Public API                │
                  │     createSiteToMcp(config)         │
                  └─────────────────────┬───────────────┘
                                        │
                  ┌─────────────────────┴─────────────────────┐
                  │                                            │
                  ▼                                            ▼
        ┌───────────────────┐                       ┌───────────────────┐
        │      CORE         │                       │     ADAPTERS      │
        │                   │                       │                   │
        │  audit/           │                       │  nextjs/          │
        │  autofix/         │                       │  express/         │
        │  content-extractor│                       │  astro/           │
        │  schema/          │ ◄────────────────────►│  wordpress/       │
        │  llms-txt/        │                       │  vanilla/         │
        │  mcp-server/      │                       │                   │
        │  monitoring/      │                       │  + CLI            │
        │  scoring/         │                       │                   │
        └───────────────────┘                       └───────────────────┘
                  │                                            │
                  ▼                                            ▼
        ┌───────────────────────────────────────────────────────┐
        │                Output / Side Effects                   │
        │                                                         │
        │  • HTML head injection (<script type="ld+json">)        │
        │  • Static files in public/  (llms.txt, robots, sitemap) │
        │  • Runtime responses (markdown for AI bots)             │
        │  • HTTP endpoints (.well-known/mcp.json)                │
        │  • Reports (markdown, JSON)                             │
        └─────────────────────────────────────────────────────────┘
```

## Module breakdown

### `core/audit/`

Klasa `AuditEngine` — 6-warstwowy auditor. Input: URL (albo raw HTML). Output: `AuditReport` z `findings: Finding[]` + `scores`.

Warstwy:

| Layer | Co sprawdza | Liczba findings |
|-------|-------------|-----------------|
| `indexability` | HTTP status, rendering (SSR/CSR), canonical, noindex, lang, title/desc length, mixed content, AI bot access (3 bots fetched osobno z różnymi UA) | ~12 |
| `schema` | Tier 1 (Org/WebSite/Breadcrumb), Tier 2 (Article/Product/LocalBusiness/HowTo/QAPage), FAQPage, Person, Speakable, parse errors | ~10 |
| `semantic_html` | H1 uniqueness, main, article, blockquote presence | ~5 |
| `content` | Word count, first-30%-answered, heading-query match, question marks, stats density, entity density, og:image, dates | ~9 |
| `ai_files` | robots.txt + per-bot allow, sitemap.xml, llms.txt, llms-full.txt, feed.xml, /.well-known/mcp.json | ~10 |
| `performance` | LCP/CLS/INP (jeśli PageSpeed API key) | ~3 |

Każdy `Finding` ma `severity` (critical/high/medium/low/info), `autofixable: boolean`, `citation` (skąd wiemy że to działa). Scoring waży severity i computes per-layer + overall 0-100 + grade A-F.

### `core/autofix/`

Klasa `Autofixer`. Input: `AuditReport`. Output: `AutofixResult` z `applied`, `skipped`, `filesGenerated`, `diff`.

Mapowanie `Finding.autofix.action` → konkretna mutacja:

| Action | Mutuje | Risk |
|--------|--------|------|
| `inject_canonical` | `<head>` + `<link rel="canonical">` | zero |
| `set_html_lang` | `<html>` attr lang | zero |
| `inject_schema` | `<head>` + JSON-LD `<script>` | zero |
| `wrap_in_main` | Body children → `<main>` | medium |
| `wrap_in_article` | Main children → `<article>` | low |
| `generate_file` | NIE mutuje HTML — produkuje nowy plik (llms.txt/robots/sitemap/agent-card itd.) | zero |
| `allow_bot_in_robots` | Regeneruje robots.txt | low |
| `remove_noindex` | Usuwa meta robots noindex | low |

Risk gate: domyślnie `maxRisk: 'low'`. Plugin nigdy nie zaaplikuje `medium`/`high` bez explicit user opt-in. To rozszerzony pattern z `seo-llm-auditor` skill (PicoSEO).

### `core/content-extractor/`

`ContentExtractor` — HTML → `ExtractedContent`:
- markdown (przez Turndown, ~80% redukcja vs HTML)
- headings z `isQuestion` flag
- Q&A pairs (z FAQPage schema lub H3-question pattern)
- stats/liczby (regex: `\d+%|\d+\s*(tys|mln|mld|x|times)`)
- quotes (`<blockquote>` + `"text" — author` pattern)
- tables (HTML table → headers + rows)
- entities (proper nouns, occurrences ≥ 2)
- outbound links (oznaczone `isAuthoritative` jeśli z autorytatywnych domen)
- metrics: word count, entity density, question marks, h3 questions %, first 30% answered, avg chunk words
- schema found (parsed JSON-LD blocks)

Plus utility `estimateTokens(text, lang)` — ~4 chars/token EN, ~3 chars/token PL.

Plus `chunkText(markdown, targetWords)` — split na 50-150 słów chunks (research: 2.3x więcej cytowań).

### `core/schema/`

`buildSchemaBundle()` — high-level constructor pełnego `@graph` JSON-LD.

Templates (każdy = function `input → JSON-LD object`):

| Type | Tier | Funkcja |
|------|------|---------|
| Organization | 1 | `organization(brand, siteUrl)` |
| WebSite + SearchAction | 1 | `website(siteUrl, name, lang)` |
| BreadcrumbList | 1 | `breadcrumbList(items)` |
| Article/BlogPosting/NewsArticle | 2 | `article(input, type)` |
| Person | 2 | `person(p, baseUrl)` |
| FAQPage | 2 | `faqPage(items)` |
| Product | 2 | `product(input)` |
| LocalBusiness | 2 | `localBusiness(input)` |
| HowTo | 2 | `howTo(input)` |
| Service | 2 | `service(input)` |
| QAPage | 3 (emerging) | `qaPage(input)` |
| SpeakableSpecification | 3 | `speakableSpecification(selectors)` |

Plus utility `graphBundle(items)` — wraps wiele schema w `@graph` + `toScriptTag(schema)` — XSS-safe `<script>` rendering.

### `core/llms-txt/`

Wszystkie generatory plików "AI well-known":
- `generateLlmsTxt(input)` → AnswerDotAI markdown
- `generateLlmsFullTxt(input)` → pełna treść strony, cap 28k tokens (poniżej 30k Osmani limit)
- `generateRobotsTxt(input)` → z 6 AI bots split (search vs training)
- `generateSitemapXml(entries)` → standard sitemap + hreflang alternates
- `generateRss(input)` → RSS 2.0 z self-link
- `generateAgentCard(input)` → A2A spec JSON
- `generateHeadersFile(input)` → Cloudflare/Netlify `_headers` z `Content-Signal`
- `generateSkillMd(input)` → Osmani layer 3 markdown
- `generateAgentsMd(input)` → AGENTS.md skeleton (human-fill only — ETH Zurich March 2026)
- `generateAiTxt(input)` → eksperymentalny ai.txt

### `core/mcp-server/`

3 podsystemy:

1. **`PageIndex`** — in-memory store wszystkich stron (path, url, title, headings, tokens, lazy full content). Plus lekki search po tytułach + headings.
2. **`MCPServer`** — implementuje MCP-over-HTTP. Handle JSON-RPC 2.0 dla: `initialize`, `tools/list`, `tools/call`, `resources/list`, `resources/read`. 6 tools: `list_pages`, `get_page`, `search_pages`, `get_schema`, `get_faq`, `get_brand`.
3. **Content negotiation** — `detectAiBot(ua)` (15 patterns), `shouldServeMarkdown(ctx)` (4 sygnały: .md suffix, Accept header, ?format=md, bot UA), `htmlToMarkdownResponse(html, url, lang)` (Turndown + headers `X-AI-Tokens`, `X-AI-Source-URL`, `Vary: Accept, User-Agent`).

### `core/monitoring/`

`Monitor` — testuje prompty przeciw 4 silnikom (OpenAI, Anthropic, Perplexity, Google Gemini).

Per silnik: dedykowany API caller, error handling, format-aware (np. Perplexity zwraca `citations: []` osobno).

Per prompt: heurystyka detekcji cytowania (case-insensitive search nazwy brand + domain), wyodrębnianie konkurencji z odpowiedzi + URL-i, sentiment (keyword-based: positive/neutral/negative).

Output: `CitationCheck[]` + `MonitoringReport` (citation rate per engine, share of voice, new/lost mentions vs history, sentiment breakdown) + `reportToMarkdown()` do Slack/Notion/Email.

### `core/scoring/`

`computeOverallScore(report)` → `ScoringResult` z:
- `overall: number` (0-100)
- `letter: ScoreLetter` (A+ / A / B / C / D / F)
- `category: 'ready' | 'needs_work' | 'not_ready'`
- `failed`, `warnings`, `passed` (split findings)
- `recommendations: string[]` (top 10 by impact)

Wagi w computeScores (audit/index.ts):
- `indexability: 20%`
- `schema: 20%`
- `semantic_html: 10%`
- `content: 30%`  ← najważniejsze
- `ai_files: 15%`
- `performance: 5%`

Decyzja: content waży najwięcej bo to jedyna warstwa, której plugin **nie naprawia automatycznie**. Indexability + schema + semantic + ai_files są autofixable; content jest design decision.

## Data flow examples

### Audit + autofix flow

```
URL → fetch (Browser UA) → HTML
                          ↓
                        parse $ ←  cheerio
                          ↓
                        extractMeta($)
                        extractHeadings($)
                        extractJsonLd($)
                        extractMainText($)
                          ↓
                       findings[] ← audit per layer
                          ↓
                       fetchAllBots(GPTBot/ClaudeBot/PerplexityBot) → findings += aiBotAccess
                       fetch /robots.txt, /sitemap.xml, /llms.txt → findings += aiFiles
                          ↓
                        computeScores(findings)
                          ↓
                     AuditReport { findings, scores, meta, rawHtml }
                          ↓
                       autofix(report, config)
                          ↓
                  AutofixResult { applied, skipped, filesGenerated, diff }
```

### Runtime negotiation flow (Next.js middleware)

```
Request → middleware
            ↓
       URL.pathname
       Headers (accept, user-agent)
            ↓
       Special paths?
         /llms.txt        → return generateLlmsTxt()
         /robots.txt      → return generateRobotsTxt()
         /sitemap.xml     → return generateSitemapXml()
         /.well-known/mcp.json → MCPServer.handle() (GET=manifest, POST=JSON-RPC)
            ↓
       shouldServeMarkdown(ctx)?
         pathname.endsWith('.md')  → true
         accept includes text/markdown  → true
         query.format === 'md'  → true
         detectAiBot(userAgent).isBot  → true
            ↓
       loadPageHtml(cleanPath)
            ↓
       htmlToMarkdownResponse(html, url, lang)
            ↓
       Response { body: markdown, headers: { X-AI-Tokens, X-AI-Source-URL, ... } }
```

### MCP-over-HTTP flow

```
External agent → POST /.well-known/mcp.json
                  Body: { jsonrpc: "2.0", id: 1, method: "tools/call",
                          params: { name: "get_page", arguments: { path: "/blog/foo" } } }
                    ↓
                MCPServer.handle(req)
                    ↓
                callTool('get_page', args)
                    ↓
                pageIndex.get('/blog/foo')
                  → loadFullPage('/blog/foo') (lazy)
                    ↓
                Response: { jsonrpc: "2.0", id: 1,
                            result: { content: [{ type: "text", text: "{...JSON...}" }] } }
```

## Compatibility

| Runtime | Status | Constraints |
|---------|--------|-------------|
| Node 18+ | ✓ | Default |
| Bun 1.0+ | ✓ | No issues; cheerio + turndown działają |
| Deno 1.40+ | ✓ | Wymaga `--allow-net` + `--allow-read`; importuj przez npm: |
| Cloudflare Workers | ⚠️ | NIE używaj `node:fs` (build-time tylko) ani `node:crypto`. Use `globalThis.crypto`. |
| Vercel Edge Functions | ⚠️ | Jak Cloudflare Workers |
| Browser | partial | Tylko `vanilla` adapter; nie ładuj `core/*` bezpośrednio (cheerio/turndown w bundlu) |

## Bundle size

- `core/audit` + `content-extractor` + `schema`: ~25 KB minified
- `core/llms-txt` + `mcp-server`: ~12 KB minified
- `core/monitoring`: ~5 KB minified
- Cały `dist/index.js` + deps (cheerio + turndown): ~180 KB minified, ~50 KB gzipped

Adapter Next.js + dependencies: dodaj ~60 KB do bundle (server-side, nie client).

WordPress PHP: ~20 KB jeden plik, zero JS deps.

## Testing strategy

- **Unit tests** (`tests/unit/`): per-module, fokus na pure functions (audit findings, schema templates, content extraction)
- **Integration tests** (`tests/integration/`): end-to-end z mock'iem `fetch` (HTML fixtures)
- **Adapter tests** (`tests/adapters/`): per-adapter, mockowane Request/Response

Coverage target: 80% core, 60% adapters.

## Decyzje architektoniczne (ADRs)

### ADR-001: Cheerio zamiast JSDOM

Cheerio jest 10x szybsze, ma jQuery API znane developerom, działa w Workers. JSDOM jest cięższe i wymaga full DOM API którego nie potrzebujemy. Kompromis: cheerio nie wykonuje JS (ok dla naszego use case — nie chcemy wykonywać JS, AI też nie wykonuje).

### ADR-002: Turndown zamiast remark/rehype

Remark stack jest bardziej "correct" ale ciężki (kilkadziesiąt deps). Turndown to jeden pakiet, ~30 KB. Dla naszego use case (HTML → markdown dla LLM) różnica jakości jest minimalna. Możemy switchować w v2 jeśli będzie potrzeba.

### ADR-003: Brak SQLite/DB

Pierwsza wersja jest stateless. Page index żyje w pamięci adapter'a. Monitoring history jest user responsibility (zapisuj JSON do filesystem albo R2/S3). Plus: prostsza dystrybucja, brak migration story, działa w Workers/Edge bez D1.

### ADR-004: JSON-RPC 2.0 dla MCP

Spec MCP wymaga JSON-RPC nad transportami (stdio, SSE, HTTP). Wybraliśmy HTTP bo to jedyny transport dostępny dla web (Workers/Edge nie mogą stdio). HTTP streaming nie implementujemy w v1 — tools call jest sync.

### ADR-005: Brand-agnostic core, branded factory

`SiteToMcp` class jest factory-style — wszystkie metody używają `this.config.brand`. Core templates (`schema/templates.ts`) przyjmują `brand` jako argument. Dlatego ten sam core obsługuje multi-tenant scenariusze (jeden Worker, wiele stron).

### ADR-006: Optional dependencies dla adapterów

`next`, `express`, `astro` są w `peerDependencies` z `peerDependenciesMeta.optional: true`. Plugin instaluje się bez nich; adapter wykorzystuje je tylko gdy są obecne. Konsekwencja: każdy adapter jest osobny moduł importowany przez subpath (`/next`, `/express`, `/astro`).

## Performance

- Audit (single page): 1-3 sekundy (1× browser fetch + 3× AI bot fetches + 6× HEAD requests for AI files)
- Schema bundle build: <10 ms
- Content extraction: 20-100 ms (zależy od długości HTML)
- llms.txt generation: <50 ms dla 100 stron
- MCP tool call (in-memory PageIndex): <5 ms

Bottleneck: HTTP requests. Audit można paralelizować (już są — Promise.all w `fetchAllBots`).

## Security

- **NIGDY** nie loguj API keys (OpenAI/Anthropic/etc.). Klucze idą tylko do request headers.
- **XSS** w schema serialization: `toScriptTag` escapuje `</script>` w content (XSS-safe).
- **SSRF** w MCP fetch tools: tylko same-origin (page index). External fetch tylko z explicit allowlist (audit / monitoring).
- **Rate limiting** dla MCP endpoint: konfigurowalny `rateLimitPerMin` (default 60). Implementacja w adapterach (nie w core).
- **Auth** dla MCP endpoint: opcjonalny `requireAuth: true` + `authToken`. Adapter sprawdza `Authorization: Bearer`. NIE używaj tego do private content — to "soft" gate.

## Contributing

PR welcome. Reguły:

1. Każdy nowy fix w autofix MUSI mieć:
   - `id` (np. `IDX-009`, `SCH-T4-Product`)
   - `citation` (skąd wiemy że to działa)
   - `risk` (zero/low/medium/high)
   - test w `tests/unit/autofix/`
2. Każdy nowy schema type MUSI:
   - Mieć function w `core/schema/templates.ts`
   - Być dodany do `SchemaType` union w `types/index.ts`
   - Przechodzić Google Rich Results Test (manual check przed merge)
3. Nowy adapter? Patrz `core/audit/`, `core/llms-txt/`, `core/mcp-server/`. Adapter NIGDY nie powinien duplikować logiki — tylko binding.
