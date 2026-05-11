# Jak to działa — w prostych słowach

> Wtyczka która sprawia że ChatGPT, Perplexity, Claude i Gemini polecają twoją stronę.

---

## W jednym akapicie

Wpinasz plugin w stronę swojego klienta. Plugin **uczy stronę języka AI** — dodaje informacje których AI szuka (schema, llms.txt, MCP endpoint), wykrywa AI boty i serwuje im czysty markdown zamiast HTML. Strona od tej pory pojawia się w odpowiedziach ChatGPT/Perplexity/Claude/Gemini gdy ktoś pyta o tematy klienta. **Działa wiecznie bez subskrypcji.**

---

## Co dostaje twój klient

### 1. **Strona widoczna w AI search**
Gdy ktoś pyta ChatGPT "kto robi X w Polsce", odpowiedź zawiera link do strony klienta.

### 2. **Wyższy ranking w Google AI Mode**
Google ma teraz AI Overviews — 48% wszystkich wyszukiwań kończy się tutaj. Plugin sprawia że klient jest w tych odpowiedziach.

### 3. **Strona jako "narzędzie" dla Claude Desktop/Cursor**
Plugin wystawia **MCP server** — agenci AI (Claude Desktop, Cursor, ChatGPT Operator) mogą podpiąć stronę i jej zadawać pytania jak narzędziu. 12 narzędzi: szukaj stron, pobierz cennik, pobierz zespół, pobierz case studies, pobierz FAQ, etc.

### 4. **Zero kosztów stałych**
Klient płaci ci raz za wdrożenie. Potem **nic** — żadnych subskrypcji, żadnych miesięcznych opłat za "AI optimization service".

---

## Jak działa technicznie (3 zdania)

1. **Raz przy wdrożeniu** — uruchamiasz wizard u siebie: `s2m-autopilot onboard https://klient.pl`. Lokalna Ollama (na twoim komputerze) generuje wszystko czego AI potrzebuje: alt-texty dla obrazów, schema JSON-LD, llms.txt, optimized titles. Output: folder `seo-bake/` ze statycznymi plikami.
2. **Klient deployuje folder + plugin core** razem ze swoją stroną. Plugin czyta pre-computed pliki przy każdym request — **zero LLM runtime**.
3. **Po wdrożeniu strona "żyje własnym życiem"** — żadnego połączenia z tobą, żadnego serwera, żadnego AI. Strona po prostu serwuje statyczne pliki AI bot'om.

---

## Dla kogo ten plugin

✓ **Agencja SEO/marketing** (jak Wise People) — wdrażasz klientom za 3-8k PLN setup + opcjonalny monthly retainer
✓ **Freelancer dev** — sprzedajesz "AI Visibility Setup" jako produkt
✓ **Właściciel strony który** chce pojawiać się w ChatGPT/Perplexity gdy ktoś pyta o jego branżę
✓ **Klient B2B** — case studies cytowane gdy potential buyer pyta AI "kto robi X w Polsce"
✓ **Sklep e-commerce** — produkty pojawiają się gdy ktoś pyta "najlepsze X dla Y"
✓ **Lokalna firma** — strona pojawia się gdy AI dostaje "near me" query

---

## Jeden dzień, jeden klient

```
09:00  Wizard onboarding              30 min
09:30  Bake (Ollama mieli w tle)      30-60 min
10:30  Citation scoring per page      15 min
10:45  Outreach generator             20 min
11:00  Deploy do klienta              60-90 min
12:30  Lunch
13:30  Verify endpoints               15 min
14:00  Outreach emails (5 wysyłka)    90 min
16:00  ✓ Klient ready
```

---

## Jak zacząć — 3 komendy

```bash
# 1. Klonuj
git clone https://github.com/nicolasworoszylo-jpg/site-to-mcp.git
cd site-to-mcp && npm install && npm run build

# 2. Wizard (interactive, 1-day workflow)
npx s2m-autopilot onboard https://klient.pl

# 3. Po deploy — weryfikacja
npx site-to-mcp verify https://klient.pl
```

---

## Co plugin DOKŁADNIE robi (5 kategorii)

### A. Strona staje się "czytalna przez AI"
- ✅ Każda strona ma JSON-LD `@graph` (Organization + WebSite + Article + Person + FAQPage + Speakable)
- ✅ Plik `/llms.txt` — mapa strony dla LLM (spec AnswerDotAI)
- ✅ Plik `/llms-full.txt` — pełna treść strony w jednym pliku (max 28k tokenów)
- ✅ `/robots.txt` z **15 AI bots** properly split (search bots allow, training bots opcjonalnie)
- ✅ `/sitemap.xml` + RSS feed (Perplexity polluje co 1-6h vs days dla recrawl)
- ✅ Wszystkie alt-texty na obrazach (Ollama vision generuje per obraz)

### B. Strona "rozmawia" z AI dynamicznie
- ✅ Gdy GPTBot/ClaudeBot/PerplexityBot wchodzi → dostaje **czysty markdown** zamiast HTML (80% mniej tokenów)
- ✅ Header `X-AI-Tokens` mówi agentowi ile tokenów to ma
- ✅ `Accept: text/markdown` lub `.md` suffix wymuszają markdown response

### C. Strona jako MCP server (12 tools dla LLM)
- ✅ Endpoint `/.well-known/mcp.json` — JSON-RPC 2.0
- ✅ Narzędzia: `list_pages`, `get_page`, `search_pages`, `get_schema`, `get_faq`, `get_brand`, `get_pricing`, `get_team`, `get_case_studies`, `get_contact`, `get_testimonials`, `get_faq_for_topic`
- ✅ Claude Desktop / Cursor / IDE-owe AI podpinają stronę jako narzędzie

### D. Citation worthiness — analizator "cytowalności"
- ✅ Per strona score 0-100 na 7 osiach (statystyki / cytaty / unique claims / entity density / pytania / świeżość / schema)
- ✅ Konkretne rekomendacje "co dodać żeby zwiększyć score" z research citations
- ✅ Przykład: "Dodaj 19 statystyk/liczb → +75 pts (Wellows 2025: 5.4 vs 2.8 AI citations)"

### E. Outreach do brand mentions
- ✅ Wyszukuje top 20 stron SERP per keyword
- ✅ Wykrywa "citation gap" — strony cytujące konkurencję, nie ciebie
- ✅ LLM generuje personalized email outreach dla top 5

---

## Twój workflow (Wise People style)

### Wdrażanie klienta (jeden dzień, raz):

```bash
npx s2m-autopilot onboard https://klient-1.pl --out ./klient-1
```
Wizard pyta o brand, autor, keywords, konkurencję. Potem **automatycznie**:
- Audituje stronę
- Generuje schema
- Bakeuje statyczne pliki
- Ocenia citation worthiness top 5 stron
- Znajduje 10 outreach candidates
- Daje deploy instructions dla Next.js/WordPress/static

### Po deploy:

```bash
# Sprawdź czy wszystko działa
npx site-to-mcp verify https://klient-1.pl

# Raport co poprawić (per strona)
npx s2m-autopilot score https://klient-1.pl/blog/post
```

### Ad-hoc gdy klient prosi (np. raz na 3 miesiące):

```bash
# Refresh bake (tylko zmienione strony)
npx s2m-autopilot bake --refresh --site https://klient-1.pl

# Rank check
npx s2m-autopilot rank-check "kw1,kw2,kw3" --domain klient-1.pl

# Tygodniowy raport
npx s2m-autopilot report --out raport.md
```

### Dla agencji z 100+ klientami:

```bash
npx s2m-autopilot wp init --agency "Wise People"
npx s2m-autopilot wp add-client × 100  # albo edit JSON
npx s2m-autopilot wp bake-all --concurrency 3  # parallel, resumable
npx s2m-autopilot wp dashboard --format html --out dashboard.html
npx s2m-autopilot wp deploy-all
```

---

## Co kosztuje (i nie kosztuje)

### Co kosztuje twój czas:
- Wdrożenie klienta: **4-6 godzin** jednorazowo
- Refresh co kwartał: **30 minut**
- Ad-hoc raport: **1 godzina**

### Co kosztuje pieniądze:
- **0 PLN/mc** — wszystko lokalnie (Ollama już masz)
- Ewentualnie free APIs: Google PSI, GSC, Bing Webmaster, IndexNow — **wszystko free tier**

### Co możesz brać od klienta:
| Tier | Setup | Refresh kwartalny | Retainer |
|---|---|---|---|
| Tier A (e-commerce/SaaS) | 8 000 PLN | 1 000 PLN | 1 500 PLN/mc |
| Tier B (B2B services) | 5 000 PLN | 700 PLN | 1 000 PLN/mc |
| Tier C (corporate/blog) | 3 000 PLN | 500 PLN | 800 PLN/mc |

**Marża ~95%** (tylko twój czas + Ollama lokalnie).

---

## Dlaczego to działa (research)

Plugin bazuje na **16 zwalidowanych tezach** z badań 2024-2026:

- **Brand mentions** = 3:1 vs backlinks (Ahrefs, 75 000 brands)
- **44.2%** AI citations pochodzi z **pierwszych 30%** treści (Indig 30M citations)
- **JSON-LD schema** = **3.2× więcej** cytowań w AI Overviews (Rankeo 2026)
- **FAQPage schema** = **3.2× więcej** w Google AI Overviews mimo śmierci rich snippets (ALM 2026-05)
- **Question headings** = **78.4%** cited content (SE Land Indig)
- **Expert quotes** = **4.1 vs 2.4** citations avg (SE Journal)
- **19+ stats** = **5.4 vs 2.8** citations avg (Wellows)
- **48%** wszystkich queries Google = AI Overview (marzec 2026)
- **93%** AI Mode searches = **zero kliknięć** (Semrush 2025) — bycie cytowanym to **jedyna** widoczność

---

## Często zadawane pytania

**Q: Czy moja Ollama musi być online cały czas?**
A: NIE. Ollama potrzebna tylko przy **wdrożeniu** (raz, 30-60 min) i **refresh** (raz na kwartał, 5-10 min). Strona klienta nie ma żadnego połączenia z Ollamą.

**Q: Co jeśli klient zmieni treść — czy plugin się sam updateuje?**
A: NIE. Plugin serwuje pre-computed treść. Aby zaktualizować, odpalasz `bake --refresh` u siebie (tylko zmienione strony) i wysyłasz updated `seo-bake/` folder do klienta. Trwa minut.

**Q: Czy plugin działa z WordPress?**
A: TAK. PHP plugin self-contained, zero JavaScript deps. Skopiuj `site-to-mcp.php` do `wp-content/plugins/`, aktywuj, save permalinks, gotowe.

**Q: Czy plugin działa z Next.js/Astro/Express?**
A: TAK. Każdy framework ma osobny adapter (`@vidok/site-to-mcp/next`, `/astro`, `/express`).

**Q: Czy klient widzi że ma "plugin SEO"?**
A: NIE. Plugin jest niewidoczny w UI strony. Tylko AI bots dostają inne odpowiedzi. Normalna nawigacja użytkownika niezmieniona.

**Q: Co jeśli klient ma sklep WooCommerce?**
A: Plugin auto-wykryje `is_product()` i wstawia `Product` + `Offer` + `AggregateRating` schema (v1.2+).

**Q: Czy potrzebuję płacić za GPT/Claude API?**
A: NIE — wszystko Ollama lokalnie. Citation monitoring (opcjonalny) wymaga **opcjonalnie** OpenAI/Anthropic API key, ale to ad-hoc — nie potrzebne do działania pluginu.

**Q: Czy mogę sprzedawać to jako swoją usługę?**
A: TAK. Plugin jest MIT licensed. Możesz brand'ować jako "Wise People AI Visibility" lub jak chcesz.

---

## Dalej

- **[README.md](README.md)** — overview + filozofia
- **[docs/SINGLE-CLIENT-WORKFLOW.md](docs/SINGLE-CLIENT-WORKFLOW.md)** — jeden dzień per klient
- **[docs/WISE-PEOPLE.md](docs/WISE-PEOPLE.md)** — workflow agency 100+ klientów
- **[docs/BAKING.md](docs/BAKING.md)** — "bake & forget" architecture
- **[docs/INSTALLATION.md](docs/INSTALLATION.md)** — per-framework setup
- **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** — jak to działa wewnątrz
- **[docs/API.md](docs/API.md)** — pełna referencja API

---

**Repo:** https://github.com/nicolasworoszylo-jpg/site-to-mcp
**License:** MIT
**Author:** Vidok Studio (Nicolas Woroszylo)
