# Struktura repozytorium

Krótki przewodnik po folderach — co gdzie znaleźć.

```
site-to-mcp/
│
├── 📄 README.md              ← Zacznij tutaj. Overview + filozofia + quick start.
├── 📄 STRUKTURA.md           ← Ten plik.
├── 📄 CHANGELOG.md           ← Historia wersji (v1.0.0).
├── 📄 CONTRIBUTING.md        ← Jak dodać własny adapter / fix / schema type.
├── 📄 LICENSE                ← MIT.
├── 📄 package.json           ← npm config (exports, peerDeps, scripts).
├── 📄 tsconfig.json          ← TypeScript strict mode.
│
├── 📁 docs/                  ← DOKUMENTACJA dla programistów
│   ├── INSTALLATION.md       ← Instrukcja krok-po-kroku per framework
│   ├── ARCHITECTURE.md       ← Module breakdown + data flow + ADRs
│   └── API.md                ← Pełna referencja public API
│
├── 📁 src/                   ← KOD ŹRÓDŁOWY (TypeScript)
│   │
│   ├── index.ts              ← Public API (re-exports)
│   ├── factory.ts            ← SiteToMcp class — główny orchestrator
│   │
│   ├── 📁 types/
│   │   └── index.ts          ← Wszystkie typy (single source of truth)
│   │
│   ├── 📁 core/              ← LOGIKA RUNTIME-AGNOSTIC (działa wszędzie)
│   │   ├── audit/            ← 6-warstwowy auditor (A-F score)
│   │   ├── autofix/          ← Naprawia HTML/generuje pliki
│   │   ├── content-extractor/← HTML → markdown + Q&A + stats + tokens
│   │   ├── schema/           ← 14 typów JSON-LD Tier 1-3
│   │   ├── llms-txt/         ← Generatory: llms.txt, robots, sitemap, RSS, agent-card, skill.md, AGENTS.md, _headers, ai.txt
│   │   ├── mcp-server/       ← MCP-over-HTTP + content negotiation + auth/rate-limit
│   │   ├── monitoring/       ← Citation tracker ChatGPT/Perplexity/Claude/Gemini
│   │   ├── scoring/          ← A-F grade + recommendations
│   │   └── utils/            ← fetch + HTML parsing + SSRF guard
│   │
│   ├── 📁 adapters/          ← WTYCZKI per framework (thin bindings)
│   │   ├── nextjs/           ← Next.js middleware + route handlers + build wrapper
│   │   ├── express/          ← Express router (z auth + rate-limit)
│   │   ├── astro/            ← Astro integration + .md companions
│   │   ├── vanilla/          ← Cloudflare Worker handler + browser script
│   │   └── wordpress/        ← PHP plugin (zero JS deps)
│   │       ├── site-to-mcp.php
│   │       └── README.md     ← WordPress-specific docs
│   │
│   └── 📁 cli/
│       └── index.ts          ← npx site-to-mcp ... (9 komend)
│
├── 📁 templates/
│   └── schema/               ← 6 gotowych szablonów JSON-LD do skopiowania
│       ├── tier1-organization.json
│       ├── tier1-website.json
│       ├── tier2-article.json
│       ├── tier2-breadcrumb.json
│       ├── tier2-faqpage.json
│       └── tier3-qapage.json
│
├── 📁 examples/
│   └── nextjs-demo/          ← Działający przykład integracji (zaproszeniaonline.com)
│       ├── s2m.config.json
│       ├── middleware.ts
│       └── app/
│           ├── llms.txt/route.ts
│           └── .well-known/mcp.json/route.ts
│
├── 📁 tests/
│   ├── smoke.mjs             ← Smoke test (13 testów / 51 asercji)
│   └── fixtures/
│       └── sample-blog-post.html
│
└── 📁 .github/
    └── workflows/
        ├── test.yml          ← CI: Node 18/20/22 matrix → build + smoke
        └── publish.yml       ← Auto-publish do npm na tag v*
```

## Skróty: gdzie szukać konkretnych rzeczy

| Szukasz... | Idziesz do... |
|-----------|---------------|
| "Jak to wpiąć w Next.js?" | [docs/INSTALLATION.md](docs/INSTALLATION.md#nextjs-app-router) |
| "Jak to wpiąć w WordPress?" | [src/adapters/wordpress/README.md](src/adapters/wordpress/README.md) |
| "Jakie funkcje są publicznie dostępne?" | [docs/API.md](docs/API.md) |
| "Dlaczego architektura wygląda tak?" | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| "Chcę dodać własny schema type" | [CONTRIBUTING.md](CONTRIBUTING.md#dodawanie-nowego-schema-type) |
| "Chcę dodać własny adapter" | [CONTRIBUTING.md](CONTRIBUTING.md#dodawanie-nowego-adaptera) |
| "Gotowy przykład" | [examples/nextjs-demo/](examples/nextjs-demo/) |
| "Filozofia + research" | [README.md](README.md#filozofia) |

## Quick start dla programisty

```bash
# 1. Sklonuj
git clone https://github.com/nicolasworoszylo-jpg/site-to-mcp.git
cd site-to-mcp

# 2. Zainstaluj
npm install

# 3. Zbuduj + przetestuj
npm test                       # build + 51 asercji smoke

# 4. Wypróbuj CLI
node dist/cli/index.js help    # zobacz wszystkie komendy
node dist/cli/index.js audit https://example.com

# 5. Lokalny dev server (wszystkie endpointy live)
cd examples/nextjs-demo
node ../../dist/cli/index.js serve --port 3030
# Otwórz http://localhost:3030/
```
