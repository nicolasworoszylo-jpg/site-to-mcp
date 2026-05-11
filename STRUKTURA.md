# Struktura repozytorium

Przewodnik po folderach — co gdzie znaleźć.

```
site-to-mcp/                         ← monorepo workspace
│
├── 📄 README.md                     ← Overview + filozofia + v1.2 features
├── 📄 JAK-TO-DZIALA.md              ← ⭐ ZACZNIJ TUTAJ. Prosty język.
├── 📄 STRUKTURA.md                  ← Ten plik
├── 📄 CHANGELOG.md                  ← Historia wersji (v1.0 → v1.1 → v1.2)
├── 📄 CONTRIBUTING.md               ← Jak dodać własny adapter / fix / schema
├── 📄 LICENSE                       ← MIT
├── 📄 package.json                  ← npm workspaces config
│
├── 📁 docs/                         ← DOKUMENTACJA dla programistów
│   ├── SINGLE-CLIENT-WORKFLOW.md    ← ⭐ Jeden dzień per klient
│   ├── WISE-PEOPLE.md               ← Multi-tenant 100+ klientów
│   ├── BAKING.md                    ← Pre-compute architecture
│   ├── INSTALLATION.md              ← Per-framework setup
│   ├── ARCHITECTURE.md              ← Module breakdown + ADRs
│   └── API.md                       ← Pełna referencja API
│
├── 📁 packages/
│   │
│   ├── 📁 core/                     ← @vidok/site-to-mcp (v1.2)
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── src/
│   │   │   ├── index.ts             ← Public API
│   │   │   ├── factory.ts           ← createSiteToMcp orchestrator
│   │   │   ├── types/index.ts       ← Wszystkie typy
│   │   │   ├── core/
│   │   │   │   ├── audit/           ← 6-warstwowy auditor
│   │   │   │   ├── autofix/         ← 12+ fixerów
│   │   │   │   ├── content-extractor/ ← HTML → markdown + Q&A
│   │   │   │   ├── schema/          ← 14 typów JSON-LD
│   │   │   │   ├── llms-txt/        ← Generatory AI files
│   │   │   │   ├── mcp-server/      ← MCP-over-HTTP + 12 tools + STDIO
│   │   │   │   │   ├── index.ts
│   │   │   │   │   └── stdio.ts     ← NEW v1.2 — STDIO bridge
│   │   │   │   ├── monitoring/      ← Citation tracker
│   │   │   │   ├── scoring/         ← A-F grade
│   │   │   │   ├── baked/           ← Pre-computed reader (v1.1)
│   │   │   │   ├── citation-scorer/ ← NEW v1.2 — 7-osiowa ocena
│   │   │   │   ├── verify/          ← NEW v1.2 — post-deploy check
│   │   │   │   └── utils/
│   │   │   ├── adapters/
│   │   │   │   ├── nextjs/
│   │   │   │   ├── express/
│   │   │   │   ├── astro/
│   │   │   │   ├── vanilla/
│   │   │   │   └── wordpress/site-to-mcp.php
│   │   │   └── cli/
│   │   │       ├── index.ts         ← s2m / site-to-mcp CLI
│   │   │       └── stdio.ts         ← NEW v1.2 — s2m-stdio binary
│   │   ├── templates/schema/        ← 6 templates JSON-LD
│   │   ├── examples/nextjs-demo/
│   │   └── tests/smoke.mjs          ← 56 asercji
│   │
│   └── 📁 autopilot/                ← @vidok/site-to-mcp-autopilot (v1.2)
│       ├── package.json
│       ├── tsconfig.json
│       ├── src/
│       │   ├── index.ts             ← Public API
│       │   ├── factory.ts           ← createAutopilot orchestrator
│       │   ├── types.ts
│       │   ├── modules/             ← 16 modułów SEO automation
│       │   │   ├── keyword-research.ts
│       │   │   ├── rank-tracker.ts
│       │   │   ├── alt-generator.ts       (Ollama vision)
│       │   │   ├── content-rewriter.ts    (Ollama text)
│       │   │   ├── internal-linking.ts    (Ollama embed)
│       │   │   ├── broken-links.ts
│       │   │   ├── backlink-monitor.ts    (Common Crawl)
│       │   │   ├── competitor-tracker.ts
│       │   │   ├── content-refresh.ts
│       │   │   ├── gsc-sync.ts            (Google Search Console)
│       │   │   ├── psi-monitor.ts         (PageSpeed Insights)
│       │   │   ├── indexnow-push.ts       (Bing + Google)
│       │   │   ├── hreflang-validator.ts
│       │   │   ├── canonical-validator.ts
│       │   │   ├── lighthouse-audit.ts
│       │   │   └── outreach-generator.ts  ← NEW v1.2
│       │   ├── bake/orchestrator.ts ← Pre-compute pipeline (v1.1)
│       │   ├── onboarding/wizard.ts ← NEW v1.2 — 1-day workflow
│       │   ├── wisepeople/          ← Multi-tenant (v1.1)
│       │   │   ├── types.ts
│       │   │   ├── registry.ts
│       │   │   ├── templates.ts     ← 9 industry presets
│       │   │   ├── bulk-bake.ts     ← Parallel + resumable
│       │   │   ├── dashboard.ts     ← HTML/MD/JSON aggregate
│       │   │   └── deploy.ts        ← rsync/git/sftp/manual
│       │   ├── ollama/client.ts     ← Local LLM wrapper
│       │   ├── storage/             ← SQLite (14 tabel)
│       │   ├── scheduler/           ← cron + LaunchAgent
│       │   ├── reports/             ← Markdown aggregator
│       │   └── cli/index.ts         ← s2m-autopilot CLI
│       └── tests/smoke.mjs          ← 46 asercji
│
└── 📁 .github/workflows/            ← CI (Node 18/20/22 matrix) + publish
```

## Skróty: gdzie szukać konkretnych rzeczy

| Szukasz... | Idziesz do... |
|-----------|---------------|
| "Jak to działa?" (klient/manager) | [JAK-TO-DZIALA.md](JAK-TO-DZIALA.md) |
| "Jak wdrożyć jednego klienta?" | [docs/SINGLE-CLIENT-WORKFLOW.md](docs/SINGLE-CLIENT-WORKFLOW.md) |
| "Mam 100 klientów, co teraz?" | [docs/WISE-PEOPLE.md](docs/WISE-PEOPLE.md) |
| "Jak to wpiąć w Next.js?" | [docs/INSTALLATION.md](docs/INSTALLATION.md#nextjs-app-router) |
| "Jak to wpiąć w WordPress?" | [packages/core/src/adapters/wordpress/README.md](packages/core/src/adapters/wordpress/README.md) |
| "Jakie funkcje są publicznie dostępne?" | [docs/API.md](docs/API.md) |
| "Dlaczego architektura wygląda tak?" | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| "Bake — co i jak?" | [docs/BAKING.md](docs/BAKING.md) |
| "Chcę dodać własny schema type" | [CONTRIBUTING.md](CONTRIBUTING.md#dodawanie-nowego-schema-type) |
| "Filozofia + research" | [README.md](README.md#filozofia) |

## Quick start dla programisty

```bash
git clone https://github.com/nicolasworoszylo-jpg/site-to-mcp.git
cd site-to-mcp
npm install
npm run build
npm test                              # 102 asercji (56 core + 46 autopilot)

# Single-client workflow:
npx s2m-autopilot onboard https://klient.pl --out ./klient

# Po deploy:
npx site-to-mcp verify https://klient.pl

# Score per page:
npx s2m-autopilot score https://klient.pl/blog/post
```
