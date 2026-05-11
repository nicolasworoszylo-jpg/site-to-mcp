# Installation — per framework

Pełny guide dla każdego adaptera. Wszędzie te same fields config — różni się tylko sposób wpięcia.

## Wspólny config

```ts
import type { SiteToMcpConfig } from '@vidok/site-to-mcp';

const config: SiteToMcpConfig = {
  siteUrl: 'https://example.com',
  brand: {
    name: 'Example Inc',
    legalName: 'Example Sp. z o.o.',
    description: 'Najlepszy soft do widgetów w Europie Środkowej.',
    logo: 'https://example.com/logo.svg',
    sameAs: [
      'https://linkedin.com/company/example',
      'https://github.com/example',
      'https://www.wikidata.org/wiki/Q12345',
    ],
    contact: {
      email: 'hello@example.com',
      phone: '+48 12 345 67 89',
      address: 'ul. Przykładowa 1, 00-001 Warszawa, PL',
    },
    primaryAuthor: {
      name: 'Jane Doe',
      jobTitle: 'CTO',
      url: '/zespol/jane-doe',
      sameAs: ['https://linkedin.com/in/janedoe', 'https://github.com/janedoe'],
      image: 'https://example.com/team/jane.jpg',
      credentials: ['MIT MEng', '10 years widget engineering', 'Forbes 30 Under 30'],
    },
  },
  aiBots: {
    GPTBot: false,        // OpenAI training crawler
    ClaudeBot: false,     // Anthropic training
    PerplexityBot: true,  // Perplexity search (cytowania)
    'Google-Extended': false, // Google DeepMind training
    AppleBot: true,
    Bingbot: true,
    CCBot: false,         // Common Crawl
    YouBot: true,
    Bytespider: false,    // ByteDance
  },
  mcp: {
    enabled: true,
    path: '/.well-known/mcp.json',
    rateLimitPerMin: 60,
    requireAuth: false,
  },
  llmsTxt: {
    enabled: true,
    path: '/llms.txt',
    fullPath: '/llms-full.txt',
  },
  monitoring: {
    enabled: false,  // ustaw true gdy chcesz testować cytowania
    prompts: [
      { id: 'p1', prompt: 'najlepsze widgety w Polsce', language: 'pl', brand: 'Example Inc', competitors: ['Competitor A', 'Competitor B'] },
    ],
    engines: ['chatgpt', 'perplexity', 'claude', 'gemini'],
    apiKeys: {
      openai: process.env.OPENAI_API_KEY,
      anthropic: process.env.ANTHROPIC_API_KEY,
      perplexity: process.env.PERPLEXITY_API_KEY,
      google: process.env.GOOGLE_API_KEY,
    },
  },
  autofix: {
    mutate: false,
    allowed: ['inject_meta', 'inject_schema', 'add_attribute', 'generate_file'],
    maxRisk: 'low',
  },
};
```

---

## Next.js (App Router)

### Krok 1: middleware

```ts
// middleware.ts (root projektu)
import { siteToMcpMiddleware } from '@vidok/site-to-mcp/next';
import config from './s2m.config.js';

export const middleware = siteToMcpMiddleware({
  ...config,
  loadPageHtml: async (path) => {
    // Możesz fetchować swój własny endpoint, użyć getStaticProps cache itd.
    const res = await fetch(`${config.siteUrl}${path}`);
    return res.ok ? res.text() : null;
  },
});

export const matcher = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico).*)',
  ],
};
```

### Krok 2: route handlers dla AI files

```ts
// app/llms.txt/route.ts
export { createLlmsTxtRoute as GET } from '@vidok/site-to-mcp/next';
```

Albo każdy osobno:

```ts
// app/llms.txt/route.ts
import { createLlmsTxtRoute } from '@vidok/site-to-mcp/next';
import config from '@/s2m.config.js';
export const GET = createLlmsTxtRoute(config);
```

Powtórz dla:
- `app/robots.txt/route.ts` → `createRobotsRoute`
- `app/sitemap.xml/route.ts` → `createSitemapRoute`
- `app/.well-known/agent-card.json/route.ts` → `createAgentCardRoute`
- `app/.well-known/mcp.json/route.ts` → `createMcpRoute` (GET + POST!)

### Krok 3: build-time static gen (opcjonalne)

```js
// next.config.mjs
import { withSiteToMcp } from '@vidok/site-to-mcp/next';
import config from './s2m.config.js';

export default withSiteToMcp(config)({
  // twój zwykły Next config
  reactStrictMode: true,
});
```

Po `npm run build` masz w `public/`:
- `llms.txt`, `robots.txt`, `sitemap.xml`, `skill.md`
- `.well-known/agent-card.json`

### Krok 4: schema w `<head>` per page

```ts
// app/blog/[slug]/page.tsx
import { buildSchemaBundle } from '@vidok/site-to-mcp/schema';
import config from '@/s2m.config.js';

export default async function BlogPost({ params }) {
  const post = await getPost(params.slug);
  const schema = buildSchemaBundle({
    siteUrl: config.siteUrl,
    brand: config.brand,
    page: {
      type: 'BlogPosting',
      url: `${config.siteUrl}/blog/${params.slug}`,
      headline: post.title,
      description: post.excerpt,
      image: post.coverImage,
      author: config.brand.primaryAuthor,
      datePublished: post.publishedAt,
      dateModified: post.updatedAt,
      inLanguage: 'pl-PL',
      keywords: post.tags,
      speakable: true,
    },
    faq: post.faq, // opcjonalnie
    breadcrumbs: [
      { name: 'Home', url: config.siteUrl },
      { name: 'Blog', url: `${config.siteUrl}/blog` },
      { name: post.title, url: `${config.siteUrl}/blog/${params.slug}` },
    ],
  });

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(schema.graph) }}
      />
      <article>{/* ... */}</article>
    </>
  );
}
```

---

## Express

```ts
import express from 'express';
import { siteToMcpRouter } from '@vidok/site-to-mcp/express';
import config from './s2m.config.js';

const app = express();
app.use(express.json()); // wymagane dla POST /.well-known/mcp.json

app.use(siteToMcpRouter({
  ...config,
  loadPageHtml: async (path) => {
    // Twoja logika - render template, fetch z DB itd.
    const html = await renderPage(path);
    return html;
  },
}));

// Twoje route'y
app.get('/', (req, res) => res.send('Hello'));

app.listen(3000);
```

Schema bundle do `<head>`:

```ts
import { buildSchemaBundle } from '@vidok/site-to-mcp/schema';

app.get('/blog/:slug', async (req, res) => {
  const post = await getPost(req.params.slug);
  const schema = buildSchemaBundle({ /* ... */ });
  res.send(`
    <html>
      <head>${schema.scriptTag}</head>
      <body>...</body>
    </html>
  `);
});
```

---

## Astro

```js
// astro.config.mjs
import { defineConfig } from 'astro/config';
import siteToMcp from '@vidok/site-to-mcp/astro';

export default defineConfig({
  site: 'https://example.com',
  integrations: [
    siteToMcp({
      siteUrl: 'https://example.com',
      brand: {
        name: 'Example Inc',
        // ...
      },
      aiBots: {
        GPTBot: false,
        ClaudeBot: false,
        PerplexityBot: true,
        // ...
      },
      generateMarkdownCompanions: true, // generuje /blog/foo.md obok /blog/foo/index.html
    }),
  ],
});
```

Po `npm run build` masz w `dist/`:
- `llms.txt`, `robots.txt`, `sitemap.xml`, `skill.md`
- `.well-known/agent-card.json`, `.well-known/mcp.json`
- Per-page `.md` companions (jeśli `generateMarkdownCompanions: true`)

Schema injection w komponentach:

```astro
---
// src/layouts/Article.astro
import { buildSchemaBundle } from '@vidok/site-to-mcp/schema';
const { page } = Astro.props;
const schema = buildSchemaBundle({ /* ... */ });
---
<html>
  <head>
    <Fragment set:html={schema.scriptTag} />
  </head>
  <body><slot /></body>
</html>
```

---

## WordPress

1. Skopiuj plik PHP:
   ```bash
   cp node_modules/@vidok/site-to-mcp/src/adapters/wordpress/site-to-mcp.php \
      /path/to/wordpress/wp-content/plugins/site-to-mcp/site-to-mcp.php
   ```

2. WordPress Admin → Plugins → **Aktywuj "Site to MCP — SEO for LLM"**

3. Settings → **Permalinks** → **Save** (re-flush rewrite rules — krytyczne!)

4. Settings → Site to MCP → ustaw AI bots policy + włącz/wyłącz features

5. Sprawdź endpointy:
   - `https://twoja-strona.pl/llms.txt`
   - `https://twoja-strona.pl/llms-full.txt`
   - `https://twoja-strona.pl/skill.md`
   - `https://twoja-strona.pl/.well-known/agent-card.json`
   - `https://twoja-strona.pl/.well-known/mcp.json`

6. **MCP w Claude Desktop:**
   ```json
   {
     "mcpServers": {
       "twoja-strona": {
         "url": "https://twoja-strona.pl/.well-known/mcp.json"
       }
     }
   }
   ```

---

## Cloudflare Workers / Vercel Edge

```ts
// worker.ts (Cloudflare)
import { createWorkerHandler } from '@vidok/site-to-mcp/vanilla';

export default {
  fetch: createWorkerHandler({
    siteUrl: 'https://example.com',
    origin: 'https://origin.example.com', // skąd proxy oryginalnego HTML
    brand: {
      name: 'Example Inc',
      // ...
    },
    aiBots: { /* ... */ },
  }),
};
```

```toml
# wrangler.toml
name = "example-site-to-mcp"
main = "src/worker.ts"
compatibility_date = "2026-05-01"

[[routes]]
pattern = "example.com/*"
zone_name = "example.com"
```

Deploy: `wrangler deploy`.

---

## Vanilla HTML (script tag)

Dla stron statycznych bez build process:

```html
<!DOCTYPE html>
<html lang="pl-PL">
  <head>
    <title>Example - widgety</title>
    <meta name="description" content="Najlepsze widgety w PL">

    <!-- Site-to-MCP browser script -->
    <script src="https://unpkg.com/@vidok/site-to-mcp/dist/vanilla-browser.js"
            data-brand="Example Inc"
            data-siteurl="https://example.com"
            data-copy-for-ai="true"
            async></script>

    <!-- Schema (wygeneruj raz, wstaw na stałe) -->
    <script type="application/ld+json">
      { /* ... wygenerowane przez `npx @vidok/site-to-mcp generate` ... */ }
    </script>
  </head>
  <body>
    <main>
      <article>
        <h1>...</h1>
      </article>
    </main>
  </body>
</html>
```

Co script tag dodaje:
- `<meta name="ai:tokens" content="...">` (token count strony)
- Floating "📋 Copy for AI" button (kopiuje markdown wersję do clipboard)

Statyczne pliki (`llms.txt`, `robots.txt` itd.) generujesz CLI:

```bash
npx @vidok/site-to-mcp init
npx @vidok/site-to-mcp generate llms.txt --out llms.txt
npx @vidok/site-to-mcp generate robots.txt --out robots.txt
npx @vidok/site-to-mcp generate sitemap.xml --out sitemap.xml
npx @vidok/site-to-mcp generate agent-card.json --out .well-known/agent-card.json
npx @vidok/site-to-mcp generate skill.md --out skill.md
```

Wrzuć je obok `index.html` w S3/Vercel/Netlify.

---

## Sanity check po instalacji

Po wpięciu pluginu uruchom:

```bash
npx @vidok/site-to-mcp audit https://twoja-strona.pl
```

Powinno pokazać A albo B grade (>70 score). Jeśli C/D — przeczytaj findings, większość jest autofixable.

Co jeszcze warto:

1. **Google Rich Results Test** — wklej URL z twoją stroną i sprawdź czy schema jest valid: https://search.google.com/test/rich-results
2. **MCP Inspector** — od Anthropic, do testowania MCP endpointu: `npx @modelcontextprotocol/inspector https://twoja-strona.pl/.well-known/mcp.json`
3. **AI bot test** — zrób curl z UA AI bota i sprawdź czy dostajesz HTML (nie 403):
   ```bash
   curl -A "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.0; +https://openai.com/gptbot" https://twoja-strona.pl/
   ```
4. **Markdown negotiation** — sprawdź czy z `Accept: text/markdown` dostajesz markdown:
   ```bash
   curl -H "Accept: text/markdown" https://twoja-strona.pl/blog/foo
   ```

## Co dalej

- [docs/ARCHITECTURE.md](ARCHITECTURE.md) — dlaczego plugin jest tak zbudowany, co siedzi w każdym module
- [docs/API.md](API.md) — pełna referencja API + przykłady każdej funkcji
- [README.md](../README.md) — overview + filozofia
