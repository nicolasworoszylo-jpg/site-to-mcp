# @vidok/site-to-mcp-autopilot

> Zero-subscription SEO automation. 15 modułów działających lokalnie — Ollama + SQLite + free APIs. **Bez SerpAPI, bez Ahrefs, bez Profound, bez Surfer.** Dodatek do [@vidok/site-to-mcp](../core).

## Filozofia

Większość SEO automation tools to abonament $99-499/mc na to, co da się zrobić lokalnie. Autopilot udowadnia że nie musisz nikomu płacić. Wszystkie 15 modułów używa albo:

- **Ollama** (lokalnie, $0) — qwen2.5:14b dla tekstu, llama3.2-vision dla obrazów, nomic-embed-text dla embeddings
- **Free APIs** (jednorazowy setup, $0 recurring) — Google Search Console, PageSpeed Insights, Google Indexing API, Bing Webmaster, Bing IndexNow
- **Common Crawl** (free, 250TB dataset) — backlinks
- **Direct SERP scrape** (z User-Agent rotation) — rank tracking

## Co Autopilot robi — 15 modułów

| # | Moduł | Stack |
|---|---|---|
| 1 | `keyword-research` | Google Autosuggest scraper (free, no auth) |
| 2 | `rank-tracker` | SERP scrape z UA rotation (Google/Bing/DuckDuckGo) |
| 3 | `alt-generator` | **Ollama llama3.2-vision** generuje alt dla obrazów |
| 4 | `content-rewriter` | **Ollama qwen2.5:14b** rewrites title/meta/H1 |
| 5 | `internal-linking` | **Ollama nomic-embed** embeddings → cosine similarity → propozycje |
| 6 | `broken-links` | Parallel HEAD checker (zero deps) |
| 7 | `backlink-monitor` | **Common Crawl CDX** (free) |
| 8 | `competitor-tracker` | Własny crawler — sitemap + schema analysis |
| 9 | `content-refresh` | LLM proponuje update dla pages >120 dni |
| 10 | `gsc-sync` | Google Search Console API (free, OAuth raz) |
| 11 | `psi-monitor` | PageSpeed Insights (free, 25k req/dzień) |
| 12 | `indexnow-push` | Bing IndexNow + Google Indexing API (free, instant) |
| 13 | `hreflang-validator` | Reciprocal + x-default validator |
| 14 | `canonical-validator` | Loops + chains detector |
| 15 | `lighthouse-audit` | PSI-powered audit (performance + a11y + SEO) |

## Setup (~30 min, jednorazowo)

```bash
# 1. Klon repo
git clone https://github.com/nicolasworoszylo-jpg/site-to-mcp.git
cd site-to-mcp && npm install && npm run build

# 2. Ollama (jeśli nie masz)
brew install ollama
ollama serve &
ollama pull qwen2.5:14b llama3.2-vision:11b nomic-embed-text

# 3. Free API keys
#    - Google PSI: https://developers.google.com/speed/docs/insights/v5/get-started
#    - Bing IndexNow: wygeneruj UUID, hostuj jako <uuid>.txt na swojej stronie
#    - Google Search Console: zweryfikuj domenę + pobierz OAuth credentials
#    - Bing Webmaster: zweryfikuj + pobierz API key
```

## Użycie

### Inline (kod)

```ts
import { createSiteToMcp } from '@vidok/site-to-mcp';
import { createAutopilot } from '@vidok/site-to-mcp-autopilot';

const s2m = createSiteToMcp({ siteUrl: 'https://example.com', brand: { name: 'Example' } });

const ap = createAutopilot({
  s2m,
  storage: './autopilot.db',
  ollamaUrl: 'http://localhost:11434',
  google: {
    pageSpeedKey: process.env.PSI_KEY,
    searchConsoleAuth: './gsc-credentials.json',
    indexingApiKeyPath: './google-indexing-sa.json',
  },
  bing: {
    indexNowKey: process.env.INDEXNOW_KEY,
  },
  competitors: ['rival1.com', 'rival2.com'],
  schedule: {
    'keyword-research': 'weekly sunday',
    'rank-tracker': 'daily 09:00',
    'psi-monitor': 'daily 06:00',
    'broken-links': 'weekly',
    'backlink-monitor': 'weekly',
  },
});

// Manualne uruchomienie
const result = await ap.run('keyword-research', { seed: 'cyfrowe zaproszenia' });

// Wpinanie w scheduler
ap.startScheduler();

// Tygodniowy raport
const report = ap.report();
console.log(report);
```

### CLI

```bash
# autopilot.config.json wymagany
npx s2m-autopilot health
npx s2m-autopilot keyword-research "cyfrowe zaproszenia" --max 100
npx s2m-autopilot rank-check "zaproszenia ślubne,cyfrowe zaproszenia" --domain zaproszeniaonline.com
npx s2m-autopilot alt-gen --url https://twoja.pl/blog/post --out modified.html
npx s2m-autopilot broken-links --url https://twoja.pl/
npx s2m-autopilot backlinks --domain twoja.pl
npx s2m-autopilot psi --url https://twoja.pl/
npx s2m-autopilot competitor --domains rival1.pl,rival2.pl
npx s2m-autopilot indexnow --urls https://twoja.pl/new-post,https://twoja.pl/updated
npx s2m-autopilot report --since 2026-05-01 --out report.md

# Long-running scheduler
npx s2m-autopilot schedule

# macOS LaunchAgent (przeżywa restart komputera)
npx s2m-autopilot launchagent --label pl.vidok.s2m-autopilot --interval 3600 --out ~/Library/LaunchAgents/pl.vidok.s2m-autopilot.plist
launchctl load ~/Library/LaunchAgents/pl.vidok.s2m-autopilot.plist
```

## Storage

Wszystkie dane historyczne lokalnie w SQLite (`autopilot.db`). Backup = jeden plik. Tables:

- `run_log` — historia uruchomień każdego modułu
- `keywords` — collected keywords z source
- `ranks` — daily rank tracking history
- `backlinks` — discovered backlinks
- `alt_texts` — wygenerowane alt (cache)
- `broken_links` — broken links log
- `vitals` — PSI metrics history
- `gsc_data` — GSC daily snapshots
- `refresh_suggestions` — content refresh propozycje
- `internal_link_suggestions` — propozycje linkowania
- `competitor_pages` — competitor crawl snapshots
- `embeddings` — cache embeddings (do internal-linking)
- `index_now_log` — IndexNow push history

## Limity (uczciwie)

| Module | Free tier limit | Co dalej |
|---|---|---|
| Google PSI | 25 000 req/dzień | Wystarczy dla 800 stron/dzień |
| Google Indexing API | 200 req/dzień | Tylko nowe/updated URLs — wystarczy dla większości |
| Google Search Console | 50 000 req/dzień | Plenty |
| Bing IndexNow | bez limitu | Zero auth |
| Rank tracking (direct SERP) | ~5-10 query/godz | 24h harmonogram dla 100 keywords |
| Common Crawl | bez limitu | Aktualizacja monthly (latency 1-2 mc vs Ahrefs) |
| Ollama | brak (lokalnie) | Limit RAM (16GB+ dla qwen14b) |

## Testowanie

```bash
cd packages/autopilot
npm run build
npm test     # 11 testów / 40+ asercji
```

## Licencja

MIT
