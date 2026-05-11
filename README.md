# site-to-mcp

> **Universal SEO operating system dla ery AI.** Plugin sprawia że ChatGPT, Perplexity, Claude i Gemini cytują twoją stronę. Zero subskrypcji. Działa wiecznie.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node](https://img.shields.io/badge/Node-%3E%3D18-green.svg)](#)
[![Tests](https://img.shields.io/badge/tests-102%20passing-brightgreen.svg)](#)
[![Version](https://img.shields.io/badge/version-1.2.0-blue.svg)](CHANGELOG.md)

**👉 Nowy? Przeczytaj najpierw [JAK-TO-DZIALA.md](JAK-TO-DZIALA.md) — w prostym języku.**

---

## TL;DR

1. Wpinasz plugin w stronę klienta
2. Klient dostaje JSON-LD schema, llms.txt, MCP endpoint, markdown response dla AI botów — wszystko statyczne, **zero LLM runtime**
3. ChatGPT/Perplexity/Claude/Gemini zaczynają cytować stronę
4. Klient płaci ci raz, **nigdy nie ma subskrypcji**

```bash
git clone https://github.com/nicolasworoszylo-jpg/site-to-mcp.git
cd site-to-mcp && npm install && npm run build
npx s2m-autopilot onboard https://klient.pl  # interactive 1-day wizard
```

---

## Trzy pytania które powinieneś sobie zadać

**Q1: Czy moja strona pojawia się gdy ktoś pyta ChatGPT o moją branżę?**
Jeśli NIE → ten plugin to naprawia.

**Q2: Czy płacę miesięcznie za "AI optimization" / "GEO service"?**
Jeśli TAK → plugin zastępuje to. Zero subskrypcji.

**Q3: Mam 100+ klientów, ile czasu zajmuje wdrożenie?**
Jeden dzień per klient. 4-6 godzin pracy. Po wdrożeniu klient nie potrzebuje twojej obecności.

---

## Pakiety (monorepo workspace)

| Pakiet | Co robi | Wersja |
|---|---|---|
| [`@vidok/site-to-mcp`](packages/core) | **Plugin do stron WWW.** Generuje schema, llms.txt, MCP endpoint. Wykrywa AI boty i serwuje markdown. Czyta pre-computed bake (zero LLM runtime). 5 framework adapterów (Next.js/Express/Astro/vanilla/WordPress). | **v1.2.0** ✓ |
| [`@vidok/site-to-mcp-autopilot`](packages/autopilot) | **16-modułowa automatyzacja SEO + Onboarding Wizard + Citation Scorer + Bake.** Wszystko z Ollama + Common Crawl + free Google/Bing APIs. **Zero subskrypcji**. Plus multi-tenant `wp` commands dla agency 100+ klientów. | **v1.2.0** ✓ |

---

## Co plugin DOKŁADNIE robi

### Klient dostaje (statycznie, raz przy deploy):

1. **JSON-LD `@graph` w `<head>`** — Organization + WebSite + Article + Person + FAQPage + Speakable + BreadcrumbList (14 typów)
2. **`/llms.txt`** — site map dla LLM-ów (AnswerDotAI spec)
3. **`/llms-full.txt`** — pełna treść strony w 1 pliku (max 28k tokenów)
4. **`/robots.txt`** z **15 AI bots properly split** — search bots allow, training bots opcjonalnie
5. **`/sitemap.xml`** + RSS feed
6. **`/.well-known/agent-card.json`** (Google A2A spec)
7. **`/.well-known/mcp.json`** — **MCP server z 12 tools** (JSON-RPC 2.0)
8. **`/skill.md`** (Osmani Agentic Engine Optimization)
9. **`/AGENTS.md`**, `/ai.txt`, `/_headers`

### Runtime (gdy AI bot wchodzi):

- Detect 15 AI bot UAs (GPTBot, ClaudeBot, PerplexityBot, OAI-SearchBot, Claude-SearchBot itd.)
- Serve **clean markdown** zamiast HTML z headerem `X-AI-Tokens` (80% mniej tokenów dla agenta)
- MCP-over-HTTP — Claude Desktop/Cursor mogą podpiąć stronę jako narzędzie

### Plus 12 MCP tools dla LLM:

`list_pages` · `get_page` · `search_pages` · `get_schema` · `get_faq` · `get_brand` · `get_pricing` · `get_team` · `get_case_studies` · `get_contact` · `get_testimonials` · `get_faq_for_topic`

---

## Single-client workflow (jeden dzień)

```bash
# Wszystko w jednym command:
npx s2m-autopilot onboard https://klient.pl --out ./klient

# Wizard interactive prowadzi przez:
# 1. Audit obecnej strony
# 2. Setup (brand, keywords, konkurencja, sameAs)
# 3. Industry auto-detect
# 4. Bake (5-30 min, Ollama lokalnie)
# 5. Citation worthiness scoring top 5 stron
# 6. Outreach generator (10 candidates + LLM emails)
# 7. Deploy instructions per stack (Next.js/WP/static)
# 8. Follow-up checklist + ONBOARDING_REPORT.md

# Po deploy — weryfikacja:
npx site-to-mcp verify https://klient.pl
```

📖 Pełen workflow: **[docs/SINGLE-CLIENT-WORKFLOW.md](docs/SINGLE-CLIENT-WORKFLOW.md)**

---

## Multi-tenant workflow (agency 100+ klientów)

```bash
# Init registry
npx s2m-autopilot wp init --agency "Wise People"

# Add clients (100×)
npx s2m-autopilot wp add-client --slug k1 --name "Klient 1" --url https://k1.pl --industry b2c-local

# Bulk bake (concurrency 3, resumable, parallel)
npx s2m-autopilot wp bake-all --concurrency 3

# Aggregate dashboard (HTML/markdown/JSON)
npx s2m-autopilot wp dashboard --format html --out dashboard.html

# Deploy do wszystkich
npx s2m-autopilot wp deploy-all
```

📖 Workflow dla agency: **[docs/WISE-PEOPLE.md](docs/WISE-PEOPLE.md)**

---

## Citation Worthiness Scorer (v1.2 NEW)

Per page ocena 0-100 + grade A-F + top 5 actionable recommendations.

```bash
npx s2m-autopilot score https://klient.pl/blog/post

# Output:
#   Overall: 57/100  Grade: C
#   statsDensity      ████████████████████ 100  83 stats/data points
#   expertQuotes      ····················  0   0 quotes
#   uniqueClaims      ····················  0   0/83 sourced
#   entityDensity     ██████████████████··  91  18.2% (30 entities)
#   questionCoverage  ██████████████████··  90  18 ? + 8 question H3
#   freshness         ████················  20  no datePublished
#   schemaCompleteness ███████████████····· 75  9 types, FAQPage=true
#
#   [HIGH] Dodaj 3+ cytaty ekspertów z atrybucją
#          Expected: 4.1 vs 2.4 AI citations avg (+75 pts)
```

7-osiowa ocena z konkretnymi citation źródłami (Indig 30M, Wellows, SEJ, Rankeo, ALM Corp).

---

## Verify (v1.2 NEW)

Post-deploy health check — 14 sprawdzeń AI files + MCP + bot access + schema injection:

```bash
npx site-to-mcp verify https://klient.pl

# Output:
#   ⚠ Verify deploy: https://klient.pl
#   9 pass · 3 warn · 2 fail
#
#   ✓ /llms.txt                    HTTP 200 (text/plain)
#   ✓ /robots.txt                  HTTP 200
#   ✓ /sitemap.xml                 HTTP 200 (application/xml)
#   ✗ MCP manifest (GET)           HTTP 404
#   ✗ MCP JSON-RPC tools/list      HTTP 404
#   ✓ GPTBot access                HTTP 200
#   ✓ ClaudeBot access             HTTP 200
#   ⚠ Markdown negotiation         Returns text/html (expected markdown)
#   ✓ JSON-LD schema in <head>     9 blocks, 1 @graph items
#   ✓ robots.txt AI bots           Search bots allowed: OAI-SearchBot, PerplexityBot
```

Exit code 0 = pass, 2 = fail (CI gate).

---

## Architektura "Bake & Forget"

Plugin core **nie wymaga Ollamy w runtime**. Cały AI-driven content jest pre-computed **raz przy wdrożeniu** i zapisany jako statyczne JSON. Klient deployuje folder `seo-bake/` razem ze stroną i strona "żyje własnym życiem" — bez LLM, bez subskrypcji, bez połączenia z agency.

```
1. RAZ przy wdrożeniu (u Nicolasa, Ollama na chwilę):
   npx s2m-autopilot bake --site https://klient.pl --out ./seo-bake/

2. Klient deployuje folder + plugin core:
   const s2m = createSiteToMcp({ siteUrl, brand, bakedDir: './seo-bake' });

3. Co kwartał refresh (tylko zmienione strony):
   npx s2m-autopilot bake --refresh
```

📖 Pełen workflow: **[docs/BAKING.md](docs/BAKING.md)**

---

## Wsparcie frameworków

| Framework | Status | Adapter |
|-----------|--------|---------|
| Next.js 13/14/15 (App Router) | ✓ | `@vidok/site-to-mcp/next` |
| Express 4/5 | ✓ | `@vidok/site-to-mcp/express` |
| Astro 4/5 | ✓ | `@vidok/site-to-mcp/astro` |
| WordPress 6.0+ | ✓ | PHP plugin (zero JS deps) |
| Cloudflare Workers / Vercel Edge | ✓ | `@vidok/site-to-mcp/vanilla` |
| Vanilla HTML | ✓ | CDN script + Copy for AI button |

---

## CLI overview

### `@vidok/site-to-mcp` (core):
```
site-to-mcp init                          Interactive setup
site-to-mcp audit <url>                   6-warstwowy audit + A-F score
site-to-mcp fix <url> [--apply]           Autofix (propose/apply)
site-to-mcp verify <url>                  Post-deploy health check  (NEW v1.2)
site-to-mcp generate <file>               llms.txt, robots, sitemap, agent-card, ai.txt, ...
site-to-mcp serve                         Local dev server
site-to-mcp monitor                       Citation monitoring ChatGPT/Perplexity/Claude/Gemini
s2m-stdio --baked PATH                    MCP STDIO bridge dla Claude Desktop  (NEW v1.2)
```

### `@vidok/site-to-mcp-autopilot`:
```
# Single-client (NEW v1.2)
s2m-autopilot onboard <url>               Interactive 1-day workflow
s2m-autopilot score <url>                 Citation Worthiness 0-100 + 5 recommendations
s2m-autopilot bake [--site URL]           Pre-compute do statycznych plików

# Single modules (15)
s2m-autopilot run <module>                keyword-research, rank-tracker, alt-generator,
                                          content-rewriter, internal-linking, broken-links,
                                          backlink-monitor, competitor-tracker, content-refresh,
                                          gsc-sync, psi-monitor, indexnow-push,
                                          hreflang-validator, canonical-validator,
                                          lighthouse-audit, outreach-generator

# Multi-tenant (Wise People agency 100+)
s2m-autopilot wp init                     Stwórz registry
s2m-autopilot wp add-client               Dodaj klienta
s2m-autopilot wp bake-all                 Bulk bake parallel resumable
s2m-autopilot wp dashboard                Aggregate (HTML/markdown/JSON)
s2m-autopilot wp deploy-all               Bulk deploy (rsync/git)
```

---

## Co czyni go najlepszym na rynku

Research May 2026:

| Konkurent | Cena | Ich luka |
|-----------|------|----------|
| Surfer SEO | $99/mc | Brak GEO/MCP. Tylko klasyczny SEO. |
| Profound | $499/mc | Tylko monitoring, brak optimization. |
| Yoast Premium | $99/rok | WP only. Brak MCP/STDIO/baking. |
| RankMath Pro | $59/rok | WP only. llms.txt jako jedyna AI feature. |
| `aeo.js` (77★) | $0 | Brak runtime negotiation, MCP, monitoring. |
| `agentic-seo` (195★) | $0 | Audit only, no generation, no serve, no MCP. |

**Nasz plugin:** zero recurring cost, multi-framework, **GEO + classical SEO + MCP w jednym**, bake & forget architecture, single-client wizard + multi-tenant bulk operations.

---

## Filozofia

> **1. Buduj źródła wiedzy, nie strony pod frazy.** AI wyciąga "klocki" — definicje, liczby, listy. Optymalizuj pod ekstrakcję.
>
> **2. Brand mentions > backlinks.** Mierz to co cytowane razem z marką, nie linki.
>
> **3. Zaufaj fundamentom.** 80% sukcesu = dobry SEO. 20% = nowe zasady. Nie odwracaj proporcji.
>
> **4. Zero subskrypcji.** Każde "$99/mc" w SEO-tech ma local/free equivalent — używamy go.
>
> **5. Bake once, deploy forever.** AI = build tool, nie runtime cost.

---

## Roadmapa

- **v1.0** (2026-05) — core + autopilot + 5 adapterów ✓
- **v1.1** — bake & forget architecture ✓
- **v1.2** (current) — onboarding wizard, citation scorer, rich MCP tools, STDIO, verify ✓
- **v1.3** — per-engine presets (ChatGPT vs Perplexity vs Google AI Mode), Wikipedia entity linker
- **v2.0** — SaaS hosted version (optional, dla agency które chcą gotowy stack)

---

## Linki

- 📖 [JAK-TO-DZIALA.md](JAK-TO-DZIALA.md) — **Start here. Prosty język.**
- 📖 [docs/SINGLE-CLIENT-WORKFLOW.md](docs/SINGLE-CLIENT-WORKFLOW.md) — Jeden dzień per klient
- 📖 [docs/WISE-PEOPLE.md](docs/WISE-PEOPLE.md) — Agency 100+ klientów
- 📖 [docs/BAKING.md](docs/BAKING.md) — Pre-compute architecture
- 📖 [docs/INSTALLATION.md](docs/INSTALLATION.md) — Per-framework setup
- 📖 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — Module breakdown + ADRs
- 📖 [docs/API.md](docs/API.md) — Pełna referencja API
- 📖 [STRUKTURA.md](STRUKTURA.md) — Mapa folderów

---

## License

MIT — Vidok Studio / Nicolas Woroszylo.

**Repo:** https://github.com/nicolasworoszylo-jpg/site-to-mcp
**Issues:** https://github.com/nicolasworoszylo-jpg/site-to-mcp/issues
