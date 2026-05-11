# @vidok/site-to-mcp

> Uniwersalna wtyczka SEO dla LLM. Konwertuje dowolną stronę WWW w cytowane przez ChatGPT, Perplexity, Claude i Gemini źródło. Framework-agnostic: Next.js, Express, Astro, WordPress, vanilla HTML, Cloudflare Workers.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE) [![npm](https://img.shields.io/badge/npm-1.0.0-blue.svg)](#) [![Node](https://img.shields.io/badge/Node-%3E%3D18-green.svg)](#)

---

## Co to robi

Plugin zamienia twoją stronę w 7 rzeczy naraz:

1. **Generator AI-files** — `llms.txt`, `llms-full.txt`, `robots.txt` (z poprawnym splitem AI bots), `sitemap.xml`, `feed.xml`, `/.well-known/agent-card.json`, `/.well-known/mcp.json`, `skill.md`, `AGENTS.md`, `_headers` z `Content-Signal`.
2. **Schema.org `@graph` injector** — Organization + WebSite + BreadcrumbList + Article/Product/LocalBusiness/HowTo/QAPage + FAQPage + Person + Speakable. Tier 1-3 system. Walidowane przez Rich Results Test.
3. **Runtime negotiation** — gdy żądanie ma `Accept: text/markdown`, kończy się na `.md` lub pochodzi od AI bot (GPTBot/ClaudeBot/PerplexityBot itd.) — serwuje czysty markdown z nagłówkami `X-AI-Tokens`, `X-AI-Source-URL`. **~80% redukcja tokenów** dla agenta.
4. **MCP-over-HTTP server** — twoja strona staje się serwerem [Model Context Protocol](https://modelcontextprotocol.io/). Claude Desktop, Cursor, IDE agents mogą mountnąć ją jako narzędzie z 6 tools (`list_pages`, `get_page`, `search_pages`, `get_schema`, `get_faq`, `get_brand`).
5. **6-warstwowy auditor** — indexability, schema, semantic HTML, content, AI files, performance. **A-F score** + per-layer breakdown. Tryb `--threshold` dla CI/CD.
6. **Autofixer** — bezpiecznie injectuje brakujące schema, naprawia robots.txt, wraps content w `<main>`/`<article>`, dodaje `<html lang>`, generuje brakujące pliki. Iron law: zero destruktywnych zmian.
7. **Citation monitor** — testuje prompty przeciw ChatGPT, Perplexity, Claude, Gemini API, wykrywa cytowania marki + konkurencji, generuje markdown raport tygodniowy.

## Dlaczego to ma znaczenie

W 2026 połowa wyszukiwań nie kończy się klikiem — tylko cytowaniem w odpowiedzi AI. Klasyczne SEO ich nie obsługuje. GEO/AEO większości agencji to repackaging znanych technik (NeurIPS 2025 *C-SEO Bench*). Plugin koncentruje się na 4 rzeczach z dowodów empirycznych:

- **Brand mentions 3×1 vs backlinks** (Ahrefs, 75 000 brands) — schema + entity graph je amplifikują
- **44.2% citations z pierwszych 30%** treści (Indig, 30M citations) — audit flaguje "answer-first" violations
- **Heading-query match = 41% citation rate** — najsilniejszy on-page factor
- **AI crawlery nie wykonują JS** (Vercel 500M+ fetches) — auto-wykrywamy CSR i alarmujemy

Plus to czego inne pluginy nie mają: **runtime markdown negotiation** dla AI botów, **prawdziwy MCP-over-HTTP** endpoint, **per-engine presety** (ChatGPT vs Perplexity vs Google AI Mode — tylko 11% domain overlap wg Conductor 2026, więc strategie muszą być różne).

## Instalacja — 1 minuta

```bash
npm install @vidok/site-to-mcp
# albo
pnpm add @vidok/site-to-mcp
# albo (dla CLI globalnie)
npm install -g @vidok/site-to-mcp
```

WordPress: skopiuj `node_modules/@vidok/site-to-mcp/src/adapters/wordpress/site-to-mcp.php` do `wp-content/plugins/site-to-mcp/site-to-mcp.php` i aktywuj.

Vanilla HTML / CDN: wstaw script tag — patrz [docs/INSTALLATION.md](docs/INSTALLATION.md#vanilla).

## Quick start (Next.js)

```ts
// middleware.ts
import { siteToMcpMiddleware } from '@vidok/site-to-mcp/next';

export const middleware = siteToMcpMiddleware({
  siteUrl: 'https://example.com',
  brand: {
    name: 'Example Inc',
    description: 'Best widgets in town',
    logo: 'https://example.com/logo.svg',
    sameAs: ['https://linkedin.com/company/example', 'https://github.com/example'],
    contact: { email: 'hello@example.com' },
    primaryAuthor: {
      name: 'Jane Doe',
      jobTitle: 'CTO',
      sameAs: ['https://linkedin.com/in/janedoe'],
      credentials: ['MIT MEng', '10 years widget engineering'],
    },
  },
  aiBots: {
    // training (zwykle disallow)
    GPTBot: false, ClaudeBot: false, 'Google-Extended': false,
    'AppleBot-Extended': false, CCBot: false, Bytespider: false, 'Meta-ExternalAgent': false,
    // search/citations (rekomendowane allow — to są bots które dają cytowania)
    'OAI-SearchBot': true, 'ChatGPT-User': true, PerplexityBot: true,
    'Claude-SearchBot': true, 'Claude-User': true, Bingbot: true,
    // mixed
    AppleBot: true, YouBot: true,
  },
  loadPageHtml: async (path) => {
    const res = await fetch(`https://example.com${path}`);
    return res.ok ? res.text() : null;
  },
});

export const config = { matcher: ['/((?!api|_next).*)'] };
```

```ts
// app/.well-known/mcp.json/route.ts
import { createMcpRoute } from '@vidok/site-to-mcp/next';
export const GET = createMcpRoute(/* same config */);
export const POST = GET;
```

```js
// next.config.mjs
import { withSiteToMcp } from '@vidok/site-to-mcp/next';
export default withSiteToMcp(/* same config */)({
  // ... twój zwykły Next config
});
```

Po `npm run build` strona ma:
- `/llms.txt` — site map dla LLM
- `/llms-full.txt` — pełna treść w 1 pliku
- `/robots.txt` — z AI bots properly split
- `/sitemap.xml`
- `/.well-known/agent-card.json` — A2A discovery
- `/.well-known/mcp.json` — MCP-over-HTTP endpoint
- `/skill.md` — Osmani layer 3
- Każdy URL z `Accept: text/markdown` → czysty markdown
- W każdym `<head>` JSON-LD `@graph` + `<meta name="ai:tokens">`

## CLI

```bash
# Setup
npx @vidok/site-to-mcp init

# Audit
npx @vidok/site-to-mcp audit https://example.com
#   ▸ Audit https://example.com
#     Score: 87/100  Grade: A  Category: ready
#     Per layer:
#       indexability   ████████████████████  100
#       schema         ███████████████░····  78
#       semantic_html  ██████████████████··  92
#       content        ████████████████····  80
#       ai_files       ████████████████····  85
#       performance    ███████████████████·  95
#     ✗ Failed: 1  ⚠ Warnings: 4  ✓ Passed: 28
#
#     Top 10 recommendations:
#       [HIGH] llms.txt: HTTP 404 — Brak llms.txt
#       [MEDIUM] FAQPage schema — Brak FAQPage. 3.2x AI Overviews boost.
#       ...

# Audit jako CI gate
npx @vidok/site-to-mcp audit https://example.com --threshold 80 --json
# exit code 2 jeśli score < 80

# Wygeneruj plik (9 generatorów)
npx @vidok/site-to-mcp generate llms.txt --out public/llms.txt
npx @vidok/site-to-mcp generate llms-full.txt --out public/llms-full.txt
npx @vidok/site-to-mcp generate robots.txt --out public/robots.txt
npx @vidok/site-to-mcp generate sitemap.xml --out public/sitemap.xml
npx @vidok/site-to-mcp generate agent-card.json --out public/.well-known/agent-card.json
npx @vidok/site-to-mcp generate skill.md --out public/skill.md
npx @vidok/site-to-mcp generate AGENTS.md --out AGENTS.md
npx @vidok/site-to-mcp generate _headers --out public/_headers
npx @vidok/site-to-mcp generate ai.txt --out public/ai.txt

# Lokalny dev server (testuj wszystkie endpointy)
npx @vidok/site-to-mcp serve --port 3030
# Open http://localhost:3030/

# Propose autofix
npx @vidok/site-to-mcp fix https://example.com

# Apply autofix (modyfikuje pliki!)
npx @vidok/site-to-mcp fix https://example.com --apply

# Citation monitoring (wymaga API keys w config)
npx @vidok/site-to-mcp monitor --out report.md
```

## Wsparcie frameworków

| Framework | Adapter | Status |
|-----------|---------|--------|
| **Next.js** 13/14/15 (App Router) | `/next` | ✓ middleware + route handlers + next.config wrapper |
| **Express** 4/5 | `/express` | ✓ router middleware |
| **Astro** 4/5 | `/astro` | ✓ integration + .md companions |
| **WordPress** 6.0+ | PHP plugin | ✓ self-contained, zero deps |
| **Cloudflare Workers** / **Vercel Edge** | `/vanilla` | ✓ `createWorkerHandler` |
| **Vanilla HTML** | CDN script | ✓ Copy for AI button + meta injection |
| Vite / Nuxt / SvelteKit | — | użyj `/express` lub direct core API |

Każdy adapter używa identycznego config + core. Jedna konfiguracja, wiele runtime'ów.

## Architektura

```
@vidok/site-to-mcp/
├── core/                      ← runtime-agnostic logic
│   ├── audit/                 ← 6-warstwowy auditor
│   ├── autofix/               ← 12+ fixerów, zero destruktywnych zmian
│   ├── content-extractor/     ← HTML → markdown + Q&A + stats + tokens
│   ├── schema/                ← 14 types JSON-LD (Tier 1/2/3)
│   ├── llms-txt/              ← llms.txt / robots / sitemap / RSS / agent-card / skill.md / _headers / AGENTS.md
│   ├── mcp-server/            ← MCP-over-HTTP + content negotiation
│   ├── monitoring/            ← prompt tester ChatGPT/Perplexity/Claude/Gemini
│   └── scoring/               ← A-F grade
├── adapters/                  ← thin bindings per framework
│   ├── nextjs/                ← middleware + routes + next.config
│   ├── express/               ← router
│   ├── astro/                 ← integration
│   ├── wordpress/             ← .php plugin (zero JS deps)
│   └── vanilla/               ← browser script + worker handler
└── cli/                       ← npx @vidok/site-to-mcp …
```

Pełen diagram + decyzje architektoniczne: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Co czyni go najlepszym na rynku (vs konkurencja)

Research May 2026:

| Konkurent | Ich luka | Nasza przewaga |
|-----------|----------|----------------|
| [`aeo.js`](https://github.com/multivmlabs/aeo.js) (77★) | No runtime negotiation, no MCP, jeden template per page | Runtime middleware + MCP mode + per-engine presets |
| [`agentmarkup`](https://github.com/agentmarkup/agentmarkup) | Build-time only, no monitoring, 3 frameworki | +WordPress, +vanilla, +AI traffic monitor |
| [`next-geo`](https://github.com/continuedev/next-geo) (Continue.dev) | Tylko Next.js, no llms.txt/schema gen | Multi-framework + pełen Osmani 6-layer |
| [`agentic-seo`](https://github.com/addyosmani/agentic-seo) (Addy Osmani, 195★) | Audit-only (no generator), no runtime, no MCP | Audit + generate + serve + monitor |
| Yoast / RankMath / AIOSEO | WordPress-only, llms.txt-centric | Framework-agnostic, beyond llms.txt |

## Filozofia

> **1. Buduj źródła wiedzy, nie strony pod frazy.** AI wyciąga "klocki" — definicje, liczby, listy. Optymalizuj pod ekstrakcję.
>
> **2. Brand mentions > backlinks.** Mierz to co cytowane razem z twoją marką, nie linki.
>
> **3. Zaufaj fundamentom.** 80% sukcesu = dobry SEO. 20% = nowe zasady (passage-level, prompts, UGC). Nie odwracaj proporcji.

## Anti-patterns (czego plugin **nie** robi)

- ❌ Nie pisze treści za ciebie — to design decision
- ❌ Nie kupuje backlinków / brand mentions
- ❌ Nie obiecuje pozycji #1 (algorytm ma kilkaset sygnałów)
- ❌ Nie traktuje llms.txt jako SEO play (Mueller April 2026: "Google nie używa llms.txt") — to **agent-readiness** feature, nie magic button
- ❌ Nie aplikuje high-risk fixów bez explicit `--apply`
- ❌ Nie domyślnie nie blokuje wszystkich AI crawlers (2024 strategia broken — blokujesz citations razem z trainingiem)

## Roadmapa

- **v1.0** (teraz) — 6 warstw audit + 14 schema + 8 AI files + MCP + 5 adapterów
- **v1.1** — `--target chatgpt|perplexity|google-ai-mode` per-engine presets
- **v1.2** — content scoring (Hemingway/Flesch), competitor diff
- **v2.0** — semantic search nad PageIndex (embeddings via local Ollama)

## Licencja

MIT — Vidok Studio.

## Wsparcie

- Issues: https://github.com/vidokstudio/site-to-mcp/issues
- Docs: https://github.com/vidokstudio/site-to-mcp#readme
- Discord: TBD
- Email: nicolas@vidok.studio

---

Built on top of methodology from `~/Desktop/Claude/SEO-LLM-2026/` + 16 zwalidowanych tez w `memory/seo_llm_geo_aeo.md`. Research May 2026 contribution: Addy Osmani "Agentic Engine Optimization" framework, Conductor State of AEO/GEO 2026 (17M responses, 100M citations), Indig 30M citation study.
