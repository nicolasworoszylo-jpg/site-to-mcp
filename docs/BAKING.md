# Bake & Deploy — strona żyje własnym życiem

> Pełna automatyzacja AI optimization **bez stałych kosztów po deploy**. Pre-compute raz przy wdrożeniu (Ollama lokalnie), klient ma static files na stronie na zawsze.

## Filozofia

Plugin core ma dwa tryby pracy:

| Tryb | Co działa runtime | Wymaga | Koszt |
|---|---|---|---|
| **Dynamic** | LLM calls per request, dynamic schema generation | loadPageHtml + ewentualnie autopilot | RAM strony klienta (cheerio parse per request) |
| **Baked** (rekomendowane) | Tylko lookup w pre-computed JSON | bakedDir w configu | **$0** — wszystko statyczne |

Baked mode = **zero LLM runtime, zero subskrypcji, zero połączeń z Ollama/autopilot**. Strona klienta deployuje się jak każda inna i działa wiecznie.

## Workflow

```
   ┌─────────────────────────┐
   │  Nicolas (raz, u siebie)│      Ollama lokalnie
   │  ┌───────────────┐      │      qwen2.5:14b
   │  │ s2m-autopilot │──────┼──▶   llama3.2-vision:11b
   │  │     bake      │      │      nomic-embed-text
   │  └───────────────┘      │      
   └────────────┬────────────┘
                ▼
        seo-bake/  (folder do deploy)
        ├── manifest.json
        ├── llms.txt           ← static, pre-built
        ├── llms-full.txt      ← static, pre-built
        ├── robots.txt
        ├── sitemap.xml
        ├── skill.md
        ├── ai.txt
        ├── _headers
        ├── .well-known/
        │   ├── agent-card.json
        │   └── mcp.json
        ├── pages/             ← per-page baked data
        │   ├── <hash>.json
        │   └── ...
        └── images/            ← alt-texts cache

                ▼
   ┌─────────────────────────┐
   │  Klient (forever)       │      Plugin core czyta `seo-bake/`
   │  ┌───────────────┐      │      Zero LLM runtime
   │  │ Strona WWW    │      │      Zero połączeń z Nicolasem
   │  │ + plugin core │      │      Zero subskrypcji
   │  └───────────────┘      │
   └─────────────────────────┘
```

## Setup u Nicolasa (raz)

### 1. Klon repo

```bash
git clone https://github.com/nicolasworoszylo-jpg/site-to-mcp.git
cd site-to-mcp && npm install && npm run build
```

### 2. Ollama (już masz)

```bash
ollama serve &
ollama pull qwen2.5:14b llama3.2-vision:11b nomic-embed-text
```

### 3. autopilot.config.json (per klient)

```json
{
  "s2m": {
    "siteUrl": "https://klient.pl",
    "brand": {
      "name": "Klient",
      "description": "Co robi klient",
      "sameAs": ["https://linkedin.com/company/klient"],
      "primaryAuthor": {
        "name": "CEO klienta",
        "jobTitle": "Founder",
        "sameAs": ["https://linkedin.com/in/ceo"]
      }
    },
    "aiBots": {
      "GPTBot": false,
      "ClaudeBot": false,
      "PerplexityBot": true
    }
  },
  "ollamaUrl": "http://localhost:11434"
}
```

## Bake — jedna komenda

```bash
# Default: bake całej strony, max 100 stron, wszystkie moduły
npx s2m-autopilot bake --site https://klient.pl --out ./klient-seo-bake/

# Refresh — tylko strony których content się zmienił
npx s2m-autopilot bake --refresh

# Wybrane moduły
npx s2m-autopilot bake --modules alt,schema,markdown

# Limit stron
npx s2m-autopilot bake --max 50
```

Bake typowo zajmuje:
- **5-15 min** dla strony 20-50 podstron (Ollama na M-series Mac)
- **30-90 min** dla strony 100-200 podstron z dużą ilością obrazów

Output: folder `./klient-seo-bake/` ze **wszystkim** czego klient potrzebuje.

## Deploy u klienta

### Next.js

```bash
# 1. Skopiuj seo-bake do public/
cp -r ./klient-seo-bake public/seo-bake

# 2. Wpięcie w middleware.ts
```

```ts
// middleware.ts
import { siteToMcpMiddleware } from '@vidok/site-to-mcp/next';

export const middleware = siteToMcpMiddleware({
  siteUrl: 'https://klient.pl',
  brand: { name: 'Klient' },
  aiBots: { /* ... */ },
  bakedDir: './public/seo-bake',  // ← klucz do "życia własnego"
});
```

```ts
// app/llms.txt/route.ts (i podobne)
import { createLlmsTxtRoute } from '@vidok/site-to-mcp/next';
import config from '@/s2m.config.json';
export const GET = createLlmsTxtRoute({ ...config, bakedDir: './public/seo-bake' });
```

```tsx
// app/layout.tsx — schema injection per page
import { createSiteToMcp } from '@vidok/site-to-mcp';
import config from '@/s2m.config.json';

const s2m = createSiteToMcp({ ...config, bakedDir: './public/seo-bake' });

export default function RootLayout({ children, params }) {
  const path = params.path ?? '/';
  const schema = s2m.getSchemaForPage(path);
  return (
    <html>
      <head>
        {schema && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema.graph) }} />}
      </head>
      <body>{children}</body>
    </html>
  );
}
```

### WordPress

```bash
# 1. Upload seo-bake/ do wp-content/uploads/seo-bake/
# 2. W WP Admin → Site to MCP settings → "Baked content directory":
#    /home/user/public_html/wp-content/uploads/seo-bake/
# Plugin automatycznie czyta przy każdym request.
```

### Vanilla / Astro / Express

Identyczna idea — wystarczy `bakedDir` w config, plugin sam wczyta.

## Refresh (co 3-6 miesięcy)

```bash
# Nicolas u siebie:
npx s2m-autopilot bake --refresh --site https://klient.pl --out ./klient-seo-bake/
```

Refresh mode sprawdza `contentHash` każdej strony. Jeśli content nie zmienił się od ostatniego bake — skip. Jeśli zmienił — re-bake tylko tę stronę. Typowy refresh dla 50-strony witryny = **30 sekund** (a nie 10 minut jak pierwszy bake).

Po refresh: `rsync` albo `git push` zmienionych plików do klienta.

## Co dokładnie zawiera baked content

Per page (`seo-bake/pages/<hash>.json`):

```json
{
  "path": "/blog/jak-pisac",
  "url": "https://klient.pl/blog/jak-pisac",
  "title": "Jak pisać treści cytowane przez ChatGPT",
  "description": "Praktyczny guide oparty o 30M citation study...",
  "schemaGraph": { "@context": "https://schema.org", "@graph": [...] },
  "markdown": "# Jak pisać...\n\n...",
  "markdownTokens": 1240,
  "altTexts": {
    "/blog/cover.jpg": "Laptop with text on screen showing SEO ranking dashboard",
    "/blog/diagram.png": "Flowchart showing AI citation pipeline from query to response"
  },
  "optimized": {
    "title": "Jak pisać dla ChatGPT — 5 sprawdzonych technik 2026",
    "description": "Konkretny przewodnik: heading-query match, first 30% answer rule, FAQ structure. Bez teorii — tylko działające metody."
  },
  "qa": [
    { "question": "Co to GEO?", "answer": "GEO to..." },
    { "question": "Jak zacząć?", "answer": "Zacznij od audytu..." }
  ],
  "contentHash": "a3f5e7b2c1d4",
  "bakedAt": "2026-05-15T10:30:00.000Z"
}
```

Static files (`seo-bake/`):
- `manifest.json` — index + metadata
- `llms.txt`, `llms-full.txt`
- `robots.txt`, `sitemap.xml`
- `skill.md`, `AGENTS.md`, `ai.txt`, `_headers`
- `.well-known/agent-card.json`, `.well-known/mcp.json`

## Co plugin core robi z baked (runtime)

```
Request → middleware
   │
   ├─ /llms.txt → reader.getStaticFile('llms.txt') → 0.1ms response
   ├─ /robots.txt → ditto
   ├─ /sitemap.xml → ditto
   ├─ /.well-known/agent-card.json → ditto
   ├─ /.well-known/mcp.json → manifest + tools/list działają na PageIndex z baked
   │
   ├─ AI bot / Accept: text/markdown → reader.getMarkdown(path) → pre-computed MD
   ├─ /blog/foo.md → ditto
   │
   └─ HTML request:
      └─ middleware NIC nie modyfikuje (HTML serwowany normalnie)
      └─ Schema injection przez React/Astro/PHP korzysta z `s2m.getSchemaForPage(path)`
```

**Zero Ollama. Zero autopilot. Zero connection do Nicolasa.**

## Czas i koszt

| Operacja | Częstość | Wymaga | Czas | Koszt |
|---|---|---|---|---|
| Bake (initial) | Raz przy wdrożeniu | Ollama u Nicolasa | 5-90 min | $0 |
| Bake refresh | Co 3-6 mc | Ollama u Nicolasa | 1-10 min | $0 |
| Klient runtime | Każdy request | NIC poza serwerem strony | <5ms | $0 |

## Gdy potrzebujesz coś konkretnego ad-hoc

Bez stałego scheduler-a — odpalasz autopilot punktowo:

```bash
# Sprawdź ranking
npx s2m-autopilot rank-check "fraza1,fraza2" --domain klient.pl

# PSI snapshot
npx s2m-autopilot psi --url https://klient.pl/important-page

# Generate alt dla nowych obrazów (re-bake just images)
npx s2m-autopilot bake --modules alt --refresh

# Push do Google indexing (klient publikował nowy post)
npx s2m-autopilot indexnow --urls https://klient.pl/new-post

# Weekly raport
npx s2m-autopilot report --since 2026-05-01 --out raport.md
```

Wszystko zostawia data w lokalnym SQLite, **żaden recurring scheduler nie chodzi w tle**. Odpalasz gdy potrzebujesz.

## Podsumowanie

| Co | Gdzie | Kiedy | Koszt |
|---|---|---|---|
| Bake | Nicolas (lokalny Ollama) | Raz przy wdrożeniu + raz na kwartał | $0 |
| Plugin core | Strona klienta | Każdy request | $0 |
| Ad-hoc operacje | Nicolas | Gdy potrzebne | $0 |

To jest **właściwa architektura SaaS dla SEO/GEO**: AI = build tool, nie runtime cost.
