# Single-client workflow — jeden dzień, jeden klient

> Wdrożenie pluginu na jedną stronę klienta w 4-6h roboty. Po wdrożeniu strona "żyje własnym życiem" — zero subskrypcji, zero powrotu do Ollamy. Ad-hoc operacje opcjonalne.

## Cele wdrożenia (3 wąskie):

1. **Strona czytalna przez LLM** — SSR/MD response, schema @graph, semantic HTML, llms.txt, robots z AI bots allowlist
2. **Więcej LLM citations** — Citation Worthiness ≥ 70 (B grade) na top 5 stron, outreach list 10 candidates
3. **MCP for LLM** — twoja strona jako MCP server (12 tools): list_pages / get_page / search / get_schema / get_faq / get_brand / get_pricing / get_team / get_case_studies / get_contact / get_testimonials / get_faq_for_topic

## Harmonogram dnia (6h roboty)

```
09:00  Wizard onboarding              30 min
09:30  Bake (Ollama mieli w tle)      30-60 min (parallel z deploy planning)
10:30  Citation scoring per page      15 min
10:45  Outreach generator             20 min
11:00  Deploy do klienta (Next/WP/static)  60-90 min
12:30  Lunch
13:30  Weryfikacja endpoints + Claude Desktop test  30 min
14:00  Outreach emails — 10 personalized, send batch 5  90 min
15:30  Buffer + follow-up checklist
16:00  ✓ Klient ready
```

## Krok po kroku

### 1. Onboarding wizard (30 min)

```bash
cd ~/Projekty/wisepeople-seo
npx s2m-autopilot onboard https://klient-x.pl --out ./klient-x
```

Wizard interaktywnie pyta:
- Brand name + description
- Main author + LinkedIn
- Contact email + phone
- Industry (auto-suggest z URL)
- Target keywords (5-10)
- Competitors (3-5 domen)
- sameAs URLs (LinkedIn, GitHub, Crunchbase, Wikipedia)
- Pozwól AI training? (default no)

**Output po wizard:**
```
./klient-x/
├── s2m.config.json              ← config core plugin
├── autopilot.config.json        ← config autopilot (Ollama)
├── seo-bake/                    ← pre-computed treść (jeśli Ollama OK)
│   ├── manifest.json
│   ├── llms.txt, llms-full.txt
│   ├── robots.txt, sitemap.xml
│   ├── skill.md, AGENTS.md, ai.txt, _headers
│   ├── .well-known/{agent-card,mcp}.json
│   ├── pages/<hash>.json        ← per-page baked
│   └── images/                   ← alt-texts cache
├── autopilot.db                  ← SQLite (outreach + audit history)
└── ONBOARDING_REPORT.md          ← raport co dalej
```

### 2. Citation worthiness — top 5 stron (15 min)

Wizard automatycznie ocenia top 5 stron klienta. Output w terminalu:

```
▶ Krok 7/8: Citation worthiness scoring (top 5 stron)
  /                          B (78/100)
  /o-nas                     C (62/100)
  /uslugi                    B (74/100)
  /blog/jak-pisac            A (87/100)
  /kontakt                   D (45/100)
```

Per-page szczegółowo:

```bash
npx s2m-autopilot score https://klient-x.pl/blog/jak-pisac
```

Output:
```
Citation worthiness: https://klient-x.pl/blog/jak-pisac

  Overall: 87/100  Grade: A

Axes:
  statsDensity           ███████████████████· 95  19 stats/data points
  expertQuotes           ████████████████···· 80  4 quotes (3 z atrybucją)
  uniqueClaims           ███████████····· 60  2/19 sourced + 5 authoritative
  entityDensity          █████████████████··· 85  18.2% density (32 entities)
  questionCoverage       █████████████████··· 85  8 pytajniki + 4 question H3
  freshness              █████████████████··· 90  35 dni od mod
  schemaCompleteness     ███████████████····· 75  5 types, FAQPage=true, Person=true

Top 5 recommendations:
  [HIGH] Dodaj sourced stats + linki do autorytatywnych źródeł
    Example: <a href="https://arxiv.org/abs/...">research</a> jako reference
    Expected: 3-4× cytowanie unique data (+25 pts)
  ...
```

### 3. Outreach generator — citation gap (20 min)

Wizard znajduje 10 stron gdzie outreach. Skupia się na **citation gap** — stron które cytują konkurencję ale nie ciebie.

```bash
# Already done by wizard — sprawdź wyniki:
sqlite3 klient-x/autopilot.db "SELECT data_json FROM run_log WHERE module='outreach-generator' ORDER BY started_at DESC LIMIT 1" | jq '.candidates'
```

Top 5 ma już wygenerowane email templates (Ollama qwen14b). Czyste markdown, gotowe do wysyłki.

### 4. Deploy — 3 stack patterns (60-90 min)

#### Next.js
```bash
cp -r ./klient-x/seo-bake /path/to/klient-x-nextjs/public/seo-bake
cd /path/to/klient-x-nextjs

# middleware.ts:
cat > middleware.ts <<'EOF'
import { siteToMcpMiddleware } from '@vidok/site-to-mcp/next';
import config from './s2m.config.json' assert { type: 'json' };

export const middleware = siteToMcpMiddleware({
  ...config,
  bakedDir: './public/seo-bake',
});

export const matcher = ['/((?!api|_next).*)'];
EOF

# Route handlers
mkdir -p app/llms.txt app/robots.txt app/sitemap.xml app/.well-known/mcp.json app/.well-known/agent-card.json

cat > app/llms.txt/route.ts <<'EOF'
import { createLlmsTxtRoute } from '@vidok/site-to-mcp/next';
import config from '@/s2m.config.json' assert { type: 'json' };
export const GET = createLlmsTxtRoute({ ...config, bakedDir: './public/seo-bake' });
EOF
# (analogicznie dla pozostałych)

npm run build && npm run start
# albo: vercel deploy --prod
```

#### WordPress
```bash
# 1. Kopiuj PHP plugin
cp packages/core/src/adapters/wordpress/site-to-mcp.php \
   /var/www/klient-x/wp-content/plugins/site-to-mcp/site-to-mcp.php

# 2. Upload bake
rsync -avz ./klient-x/seo-bake/ user@klient-x.pl:/var/www/klient-x/wp-content/uploads/seo-bake/

# 3. WP Admin:
#    - Plugins → Aktywuj "Site to MCP — SEO for LLM"
#    - Settings → Permalinks → Save (flush rewrite rules)
#    - Settings → Site to MCP → set "Baked content dir": wp-content/uploads/seo-bake/
```

#### Statyczna (HTML/Astro/Hugo)
```bash
# Skopiuj contents seo-bake do public root klienta
rsync -avz ./klient-x/seo-bake/ user@klient-x.pl:/var/www/klient-x/public/
```

### 5. Weryfikacja endpoints (15 min)

```bash
# AI files
curl https://klient-x.pl/llms.txt | head
curl https://klient-x.pl/robots.txt | grep -E "GPTBot|Claude"
curl https://klient-x.pl/sitemap.xml | head
curl https://klient-x.pl/skill.md
curl https://klient-x.pl/.well-known/agent-card.json
curl https://klient-x.pl/.well-known/mcp.json

# Markdown negotiation (zachowanie dla AI bot)
curl -A "Mozilla/5.0 ... GPTBot/1.0" https://klient-x.pl/ | head
curl -H "Accept: text/markdown" https://klient-x.pl/

# MCP RPC
curl -X POST https://klient-x.pl/.well-known/mcp.json \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

### 6. Claude Desktop integration test (15 min)

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "klient-x": {
      "url": "https://klient-x.pl/.well-known/mcp.json"
    }
  }
}
```

Restart Claude Desktop. Pytania testowe:
- "Co robi firma Klient X?"
- "Ile kosztuje plan premium u Klient X?" (testuje get_pricing tool)
- "Kto jest CEO Klient X?" (get_team)
- "Pokaż case studies Klient X" (get_case_studies)

Claude powinien odpowiadać z **MCP tool calls** — widoczne w UI.

### 7. Outreach emails (90 min)

```bash
# View top 5 z LLM-generated emails:
sqlite3 klient-x/autopilot.db "SELECT data_json FROM run_log WHERE module='outreach-generator' ORDER BY started_at DESC LIMIT 1" | jq '.candidates[:5]'
```

Każdy email:
- Personalizowany (mention article title)
- Single value prop (czemu mention klienta dodaje wartość)
- Soft CTA ("would you consider...")

Ręczna review + send batch 5. Pozostałe 5 — kolejka na późniejszy follow-up.

### 8. Follow-up checklist

Zapisany w `klient-x/ONBOARDING_REPORT.md`:

- [ ] Sprawdź pierwsze 3 endpointy curl-em po deploy
- [ ] Wpisz w Claude Desktop config (user testing)
- [ ] Zarejestruj w Google Search Console (free)
- [ ] Zarejestruj w Bing Webmaster Tools (free)
- [ ] Popraw content na stronach < B grade
- [ ] Ad-hoc rank check za 2 tygodnie: `s2m-autopilot rank-check`
- [ ] Refresh bake za 3 miesiące: `s2m-autopilot bake --refresh --site https://klient-x.pl`

## Co robi się ad-hoc (Wise People → klient request)

Po pełnym wdrożeniu klient żyje sam. Tylko gdy klient prosi konkretnie:

```bash
# Klient zmienił treść, chce update bake'u:
cd ~/Projekty/wisepeople-seo/klient-x
npx s2m-autopilot bake --refresh --site https://klient-x.pl
rsync -avz ./seo-bake/ user@klient-x.pl:/var/www/klient-x/public/seo-bake/

# Klient pyta "jak rośnie nasza widoczność":
npx s2m-autopilot rank-check --domain klient-x.pl \
  --keywords "kw1,kw2,kw3" --config klient-x/autopilot.config.json
npx s2m-autopilot psi --url https://klient-x.pl --config klient-x/autopilot.config.json

# Klient prosi o report:
npx s2m-autopilot report --config klient-x/autopilot.config.json --out raport.md
```

Bez schedulera. Bez recurring. **Twoja praca tylko gdy faktycznie potrzebne.**

## Test Citation Worthiness vs efekt po wdrożeniu

Po 4-6 tygodniach **mierz delta**:

```bash
# Pre-bake (zapisz jako baseline):
npx s2m-autopilot score https://klient-x.pl/ > baseline-home.txt
npx s2m-autopilot score https://klient-x.pl/blog/key-article > baseline-blog.txt

# Po 4-6 tygodniach od deploy:
npx s2m-autopilot score https://klient-x.pl/ > after-home.txt
diff baseline-home.txt after-home.txt
```

Spodziewane:
- Score axes: minimal change (content się nie zmienia bez refresh)
- **AI citations** (mierzone osobno przez monitor module): +20-50% w 30 dni
- Google PSI: +5-15 pts po hreflang/canonical fixes
- GSC impressions: +10-30% po IndexNow + nowy sitemap

## Cennik per klient (Vidok Studio / Wise People)

| Tier | Czas wdrożenia | Cena |
|---|---|---|
| **Setup** (jednorazowo) | 4-6h jeden dzień | 3 000-8 000 PLN (per industry) |
| **Refresh** (co kwartał) | 30 min | 500-1 000 PLN |
| **Ad-hoc raport** | 1h | 300-500 PLN |
| **Monthly retainer** (opcjonalnie) | 2-4h/mc | 800-2 000 PLN/mc |

**Marża:** ~95% (tylko czas Nicolasa + lokalny Ollama, $0 stałe koszty).

## Anti-patterns

- ❌ Nie próbuj robić 5 klientów jednego dnia. **Jeden dzień = jeden klient.** Maks 2 jeśli mały (corporate/portfolio).
- ❌ Nie skip wizard — automatic config skips brand details które bardzo wpływają na Person/Organization schema.
- ❌ Nie deployuj bez weryfikacji curl. Endpointy mogą być zablokowane przez CDN/firewall klienta.
- ❌ Nie wysyłaj wszystkich 10 outreach emails od razu. Spam protection — batch 5 max per dzień.
- ❌ Nie ignoruj "follow-up checklist" — GSC + Bing Webmaster setup za jutro to **realne wsparcie** dla rankingu.
