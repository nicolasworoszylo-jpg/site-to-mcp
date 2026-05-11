# Wise People — wdrożenie na 100+ stron klientów

> Multi-tenant workflow dla agencji: jeden config, jeden command, jeden dashboard. **Wdrożenie testowe na całą 100-stronowych portfolio**.

## Architektura

```
~/Projekty/wisepeople-seo/
├── wisepeople.clients.json          ← REGISTRY: 100+ klientów w 1 pliku
├── wisepeople-portfolio/             ← BAKED CONTENT per klient
│   ├── klient-1/seo-bake/
│   ├── klient-2/seo-bake/
│   ├── ...
│   ├── klient-100/seo-bake/
│   └── .bake-state.json              ← STATE: który już zrobiony
├── credentials/                      ← per-client API keys (gitignore!)
│   ├── klient-1-gsc.json
│   └── ...
└── dashboard.html                    ← AGGREGATE: stan portfolio
```

## Setup (raz w życiu, ~10 min)

```bash
# 1. Klon repo + install
git clone https://github.com/nicolasworoszylo-jpg/site-to-mcp.git
cd site-to-mcp && npm install && npm run build

# 2. Init registry
mkdir ~/Projekty/wisepeople-seo && cd ~/Projekty/wisepeople-seo
npx s2m-autopilot wp init --agency "Wise People" --slug wise-people \
  --portfolio ./wisepeople-portfolio

# Output: utworzony wisepeople.clients.json z pustą listą
```

## Dodawanie klientów (po 1 minutę każdy)

```bash
# Quick add via CLI
npx s2m-autopilot wp add-client \
  --slug centralka \
  --name "Centralka" \
  --url https://centralka.pl \
  --industry b2c-local \
  --keywords "tłumaczenia ustne,tłumaczenia kabinowe,centralka warszawa" \
  --competitors "rival1.pl,rival2.pl" \
  --deploy-method rsync \
  --deploy-target "user@klient1.com:/var/www/site/public/seo-bake/" \
  --tags "wise-people,centralka,B2B"

# Albo edytuj JSON ręcznie — wsadowy import 100 klientów:
nano wisepeople.clients.json
```

Format `wisepeople.clients.json`:

```json
{
  "schemaVersion": "site-to-mcp-clients/2026-05",
  "agency": {
    "name": "Wise People",
    "slug": "wise-people",
    "contactEmail": "n.woroszylo@wisepeople.pl"
  },
  "portfolioDir": "./wisepeople-portfolio",
  "defaults": {
    "maxPages": 100,
    "concurrency": 3,
    "notifyWebhook": "https://hooks.slack.com/services/..."
  },
  "clients": [
    {
      "slug": "centralka",
      "name": "Centralka",
      "siteUrl": "https://centralka.pl",
      "industry": "b2c-local",
      "brand": { "name": "Centralka", "description": "...", "sameAs": [...] },
      "targetKeywords": ["tłumaczenia ustne warszawa", ...],
      "competitors": ["rival1.pl", "rival2.pl"],
      "credentials": {
        "psiKey": "AIza...",
        "gscCredsPath": "./credentials/centralka-gsc.json"
      },
      "deploy": {
        "method": "rsync",
        "target": "user@centralka.pl:/var/www/site/public/seo-bake/"
      },
      "tags": ["wise-people", "B2B-services"],
      "active": true
    }
  ]
}
```

## Industry presets (9 typów)

```bash
npx s2m-autopilot wp industries

# Wyświetla:
# b2b-saas         SaaS dla biznesu — docs, pricing, case studies
# b2b-services     Agencja/konsulting B2B — case studies, services, blog
# b2c-ecommerce    Sklep internetowy — produkty, kategorie, blog
# b2c-local        Lokalna firma — usługi w mieście, opinie, kontakt
# blog-publisher   Blog/portal contentowy — artykuły, autorzy
# corporate        Strona firmowa — about, careers, press
# nonprofit        Fundacja/NGO — misja, projekty, donate
# portfolio        Strona osobista/portfolio
# directory        Katalog/wyszukiwarka
```

Każdy preset automatycznie ustawia:
- AI bots policy właściwą dla typu (np. publisherzy blokują training)
- Schema priorities (b2c-local → LocalBusiness, e-commerce → Product, blog → Article)
- Bake modules (corporate skip rewrite, ecommerce full)
- Max pages (portfolio 50, e-commerce 500)

## Bulk bake — wszyscy klienci jeden command

```bash
# Wszystkich 100 klientów (concurrency 3 = Ollama RAM-friendly)
npx s2m-autopilot wp bake-all --concurrency 3

# Real-time output:
# ▸ Bulk bake — concurrency: 3
#   ▶ centralka (Centralka)
#   ▶ klient-2 (Klient 2)
#   ▶ klient-3 (Klient 3)
#   ✓ klient-2 — 47 pages, 89s
#   ▶ klient-4 (Klient 4)
#   ✓ klient-3 — 32 pages, 65s
#   ✗ klient-7 — Site returned 503 (offline)
#   ...
# ═══════════════════════════════════════════
#   ✓ Succeeded: 97
#   ✗ Failed: 3
#   Total pages baked: 4 832
#   Total alt-texts: 11 240
#   Total time: 38 min
```

### Refresh mode (co kwartał)

```bash
# Tylko strony z zmienionym content (contentHash check):
npx s2m-autopilot wp bake-all --refresh --concurrency 3

# Typowy refresh dla 100 klientów: 5-10 min (większość pominięta).
```

### Resume — gdy proces padnie

```bash
# Stan zapisany w wisepeople-portfolio/.bake-state.json
# Restart i kontynuuj od miejsca przerwania:
npx s2m-autopilot wp bake-all --resume
```

### Filtrowanie

```bash
# Tylko konkretne klient slugs:
npx s2m-autopilot wp bake-all --clients centralka,klient-2,klient-7

# Po industry:
npx s2m-autopilot wp bake-all --industry b2c-local

# Po tag:
npx s2m-autopilot wp bake-all --tag wise-people
```

## Status na żywo

```bash
npx s2m-autopilot wp status

# Output:
# Wise People — bake state
# Started: 2026-05-15T14:30:00.000Z
#
#   ✓ centralka            done       89s    47p
#   ✓ klient-2             done       65s    32p
#   ▶ klient-3             running
#   ⏳ klient-4             pending
#   ✗ klient-7             failed     0s
#   ⏳ klient-8             pending
#   ...
```

## Aggregate dashboard

```bash
# Markdown raport (Slack/email/Notion):
npx s2m-autopilot wp dashboard --format markdown --out dashboard.md

# HTML dashboard (jednoplikowy, otwórz w browser):
npx s2m-autopilot wp dashboard --format html --out dashboard.html
open dashboard.html

# JSON (dla custom processing):
npx s2m-autopilot wp dashboard --format json --out dashboard.json
```

HTML dashboard:
- Dark theme, mobile responsive
- 8 KPI cards (total/active/baked/failed/pending/pages/alt-texts/time)
- By industry breakdown
- Refresh status (oldest bake, newest, average)
- Failure log z error details
- Lista wszystkich klientów z status

## Deployment do 100 klientów

```bash
# Dry-run najpierw (zobacz co się stanie):
npx s2m-autopilot wp deploy-all --dry-run

# Live deploy (per-client metoda z config):
npx s2m-autopilot wp deploy-all

# Tylko wybrane:
npx s2m-autopilot wp deploy-all --clients centralka,klient-7
```

Metody per klient (w `wisepeople.clients.json` → `deploy.method`):

| Method | Co robi |
|---|---|
| `rsync` | `rsync -avz --delete bake/ user@host:/var/www/.../seo-bake/` |
| `git` | Commit w repo klienta + push do gitBranch |
| `sftp` | Placeholder (v2) |
| `manual` | Wypisz instrukcje dla klienta (mail/Slack) |

## Concurrency tuning

Ollama RAM na Apple Silicon M-series:

| Concurrency | RAM | Czas/klient | Polecane gdy |
|---|---|---|---|
| 1 | 8 GB | 5 min | M2/M3 bazowe |
| **3** | 16 GB | 2 min | **M2 Pro / M3 Pro (default)** |
| 5 | 24 GB | 1.5 min | M2 Max / M3 Max (Nicolas) |
| 8 | 32 GB+ | 1 min | M2 Ultra / M3 Ultra |

Dla 100 klientów na M-series Pro: **30-50 minut** całkowicie.

## Failure isolation

Każdy klient bake'uje w **try/catch**. Jeden popsuty (np. strona offline) **nie zatrzymuje** pozostałych 99. Errors logowane w state file + opcjonalnie Slack webhook.

```json
{
  "defaults": {
    "notifyWebhook": "https://hooks.slack.com/services/WP/X/Y"
  }
}
```

Slack message format: `Bake FAILED for klient-7: HTTP 503`.

## Workflow miesięczny

```bash
# Pierwszego dnia miesiąca, automatycznie (LaunchAgent):
0 9 1 * * cd ~/Projekty/wisepeople-seo && \
  npx s2m-autopilot wp bake-all --refresh && \
  npx s2m-autopilot wp deploy-all && \
  npx s2m-autopilot wp dashboard --format html --out ~/Desktop/dashboard.html
```

Dashboard otwiera się na desktopie. Mateusz/zarząd ma weekly status w 1 pliku.

## Sprzedaż dla Wise People

| Klient | Bake setup (jednorazowo) | Monthly retainer | Roczny revenue/klient |
|---|---|---|---|
| Tier A (e-commerce/SaaS) | 8 000 PLN | 1 500 PLN/mc | 26 000 PLN |
| Tier B (B2B services) | 5 000 PLN | 1 000 PLN/mc | 17 000 PLN |
| Tier C (corporate/blog) | 3 000 PLN | 500 PLN/mc | 9 000 PLN |

**Dla 100 klientów portfolio:**
- Setup revenue: ~500 000 PLN (one-time, w pierwszym kwartale)
- Recurring: ~1 200 000 PLN/rok (avg 12k PLN/klient × 100)
- **Koszty Wise People:** 0 PLN/mc (Nicolas + Ollama lokalnie)
- **Margin:** ~95% (tylko czas pracy nicolasa, max 8h/mc na klient'a)

## Migration z indywidualnego per-klient setupu

Jeśli wcześniej miałeś osobne configi:

```bash
# Konwertuj stare s2m.config.json klienta:
cat klient-1/s2m.config.json | jq '{
  slug: "klient-1",
  name: .brand.name,
  siteUrl: .siteUrl,
  industry: "b2c-local",
  brand: .brand,
  aiBots: .aiBots
}' >> wisepeople.clients.json.partial

# Manual merge do clients[] array w registry
```

## Anti-patterns (czego NIE robić)

- ❌ Nie bake'uj 100 klientów z concurrency 10 — Ollama padnie po 5-10 minutach
- ❌ Nie commituj `credentials/` ani `wisepeople-portfolio/` do git — wrzuć do `.gitignore`
- ❌ Nie deploy'uj **wszystkich** od razu bez `--dry-run` — sprawdź co się stanie
- ❌ Nie używaj jednego `psiKey` dla 100 klientów — Google narzuca limit per project (25k/dzień łącznie)
- ❌ Nie traktuj `wp bake-all` jako "fire and forget" — sprawdź `wp status` po 5 min czy działa

## Workflow do wdrożenia testowego dziś

```bash
# 1. Setup (10 min)
cd ~ && git clone https://github.com/nicolasworoszylo-jpg/site-to-mcp.git wisepeople-seo
cd wisepeople-seo && npm install && npm run build
npx s2m-autopilot wp init --agency "Wise People" --slug wise-people

# 2. Import 5 pilotażowych klientów (15 min ręcznie albo skrypt z listą)
npx s2m-autopilot wp add-client --slug klient-pilot-1 --name "..." --url ... --industry ...
# powtórz × 5

# 3. Bake pilotaż (30 min)
npx s2m-autopilot wp bake-all --clients klient-pilot-1,klient-pilot-2,klient-pilot-3,klient-pilot-4,klient-pilot-5

# 4. Dashboard
npx s2m-autopilot wp dashboard --format html --out dashboard.html
open dashboard.html

# 5. Manual deploy (pilot — sprawdź ręcznie 1-2 zanim deploy-all)
# Wrzuć ./wisepeople-portfolio/klient-pilot-1/seo-bake/ do klient'a public/seo-bake/

# 6. Weryfikacja:
curl https://klient-pilot-1.pl/llms.txt
curl https://klient-pilot-1.pl/.well-known/mcp.json
curl -H "Accept: text/markdown" https://klient-pilot-1.pl/

# Po 1-2 tygodniach pilotaż OK → bake-all dla pozostałych 95 klientów.
```
