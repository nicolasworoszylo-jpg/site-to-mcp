# site-to-mcp

> Universal SEO operating system. Monorepo z dwoma pakietami: **core** (GEO/AEO dla LLM) + **autopilot** (klasyczne SEO automation, zero subskrypcji). Framework-agnostic. Self-hosted. MIT.

## Pakiety

| Pakiet | Co robi | Status |
|---|---|---|
| [`@vidok/site-to-mcp`](packages/core) | Plugin do stron WWW — generuje llms.txt, robots.txt, schema, MCP-over-HTTP endpoint. AI bot detection + runtime markdown negotiation. 5 framework adapterów (Next.js, Express, Astro, vanilla, WordPress). | v1.0.0 ✓ |
| [`@vidok/site-to-mcp-autopilot`](packages/autopilot) | 15-modułowa automatyzacja SEO. Keyword research, rank tracking, alt generator (Ollama), content rewriter, internal linking, broken links, backlinks (Common Crawl), GSC sync, PSI monitor, IndexNow, Lighthouse. **Zero zewnętrznych subskrypcji**. | v1.0.0 ✓ |

## Quick start

```bash
git clone https://github.com/nicolasworoszylo-jpg/site-to-mcp.git
cd site-to-mcp
npm install      # instaluje oba pakiety
npm run build    # buduje oba
npm test         # runs smoke tests obu
```

Następnie wybierz swój use case:

- **"Chcę żeby AI cytowało moją stronę"** → [packages/core/README.md](packages/core/README.md)
- **"Chcę automatyzację SEO bez płacenia za Ahrefs/Profound"** → [packages/autopilot/README.md](packages/autopilot/README.md)
- **"Chcę oba w komplecie"** → wpina się tak:

```ts
import { createSiteToMcp } from '@vidok/site-to-mcp';
import { createAutopilot } from '@vidok/site-to-mcp-autopilot';

const s2m = createSiteToMcp({ siteUrl, brand, aiBots });
const autopilot = createAutopilot({ s2m, /* config */ });

autopilot.startScheduler();
```

## Co czyni te plug-iny unikalnymi

- **Zero recurring cost**. Wszystko lokalnie lub na free tier. Nie potrzebujesz SerpAPI ($75), Ahrefs ($129), Profound ($499), Surfer ($99), Yoast Premium ($99/rok). Total stack = **$0/mc**.
- **Framework-agnostic**. Działa z Next.js, Express, Astro, WordPress, Cloudflare Workers, vanilla HTML — jeden core, 5 thin adapterów.
- **Lokalna AI**. Ollama (qwen14b + llama3.2-vision + nomic-embed-text) — twoje dane zostają u ciebie, brak vendor lock-in.
- **MCP-over-HTTP**. Twoja strona staje się serwerem Model Context Protocol — Claude Desktop, Cursor, IDE-owe AI mogą podpiąć ją jako narzędzie.
- **GEO + classical SEO**. Większość konkurentów robi jedno albo drugie. My oba.

## Filozofia

> 1. **Buduj źródła wiedzy, nie strony pod frazy.** AI wyciąga "klocki" — definicje, liczby, listy. Optymalizuj pod ekstrakcję.
> 2. **Brand mentions > backlinks.** Mierz to co cytowane razem z twoją marką, nie linki.
> 3. **Zaufaj fundamentom.** 80% sukcesu = dobry SEO. 20% = nowe zasady (passage-level, prompts, UGC). Nie odwracaj proporcji.
> 4. **Zero subskrypcji.** Każde "$99/mc" w SEO-tech ma local/free equivalent — używamy go.

## Architektura monorepo

```
site-to-mcp/
├── package.json (workspaces)
├── packages/
│   ├── core/                          ← @vidok/site-to-mcp
│   │   ├── src/
│   │   │   ├── core/                  ← audit, autofix, schema, llms-txt, mcp-server, monitoring, scoring
│   │   │   ├── adapters/              ← nextjs, express, astro, vanilla, wordpress
│   │   │   ├── cli/
│   │   │   └── types/
│   │   ├── templates/schema/
│   │   ├── examples/
│   │   └── tests/
│   │
│   └── autopilot/                     ← @vidok/site-to-mcp-autopilot
│       ├── src/
│       │   ├── modules/               ← 15 modułów SEO automation
│       │   ├── storage/               ← SQLite schema + db.ts
│       │   ├── ollama/                ← local LLM client
│       │   ├── scheduler/             ← cron + LaunchAgent
│       │   ├── reports/               ← markdown aggregator
│       │   ├── cli/
│       │   └── types.ts
│       └── tests/
│
├── docs/                              ← shared docs (architektura, installation)
├── .github/workflows/                 ← CI
└── README.md, LICENSE, CHANGELOG.md
```

## Wsparcie frameworków (core)

| Framework | Status |
|-----------|--------|
| Next.js 13/14/15 | ✓ |
| Express 4/5 | ✓ |
| Astro 4/5 | ✓ |
| WordPress 6.0+ | ✓ (PHP plugin, zero JS deps) |
| Cloudflare Workers / Vercel Edge | ✓ |
| Vanilla HTML | ✓ (CDN script + Copy for AI button) |

## Licencja

MIT — Vidok Studio (Nicolas Woroszylo).

## Linki

- GitHub: https://github.com/nicolasworoszylo-jpg/site-to-mcp
- Issues: https://github.com/nicolasworoszylo-jpg/site-to-mcp/issues
- Core README: [packages/core/README.md](packages/core/README.md)
- Autopilot README: [packages/autopilot/README.md](packages/autopilot/README.md)
