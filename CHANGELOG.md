# Changelog

Wszystkie istotne zmiany w projekcie.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0] — 2026-05-11 — Single-client workflow

### Added — Core

- **Citation Worthiness Scorer** (`packages/core/src/core/citation-scorer/`) — 7-osiowa ocena per page 0-100 + A-F grade z konkretnymi recommendations + research citations (Wellows, Indig, SEJ, Rankeo, ALM)
- **Verify command** (`packages/core/src/core/verify/`) — post-deploy health check 14 sprawdzeń: AI files (5), MCP manifest GET + JSON-RPC POST, AI bots access (3), markdown negotiation, schema injection w `<head>`, ai:tokens meta, robots.txt deep AI bots check
- **STDIO bridge** (`packages/core/src/core/mcp-server/stdio.ts` + `packages/core/src/cli/stdio.ts`) — newline-delimited JSON-RPC 2.0 over stdin/stdout. Claude Desktop direct integration: `s2m-stdio --baked PATH`
- **Rich MCP Tools** (6 → 12) — `get_pricing`, `get_team`, `get_case_studies`, `get_contact`, `get_testimonials`, `get_faq_for_topic`
- CLI: `verify <url>` z exit code 2 dla CI gate

### Added — Autopilot

- **OnboardingWizard** (`packages/autopilot/src/onboarding/wizard.ts`) — interactive 1-day workflow: audit → setup → bake → score → outreach → deploy instructions → ONBOARDING_REPORT.md
- **OutreachGeneratorModule** (`packages/autopilot/src/modules/outreach-generator.ts`) — SERP scrape + citation gap detection (kto cytuje konkurencję, nie ciebie) + LLM-generated personalized email templates
- CLI: `onboard <url>` (interactive wizard), `score <url>` (instant 7-axis scoring)

### Added — Documentation

- `JAK-TO-DZIALA.md` — prosty język, dla nieprogramistów + klientów
- `docs/SINGLE-CLIENT-WORKFLOW.md` — full 6h workflow per klient z cennikiem (Tier A/B/C: 3-8k PLN)
- Updated `README.md` — v1.2 features + roadmap
- Updated `STRUKTURA.md` — nowe pliki

### Tests

- Core: 56 asercji (51 + 5 nowe: MCP 12-tools, get_pricing, get_team)
- Autopilot: 46 asercji (16 modules check)
- Live verified: `verify` on zaproszeniaonline.com (9 pass / 3 warn / 2 fail), `score` 57/100 C z 5 actionable recs

## [1.1.0] — 2026-05-11 — Bake & Forget

### Added

- **BakeOrchestrator** + **BakedContentReader** — pre-compute architecture
- Plugin core nie wymaga Ollamy w runtime
- CLI: `bake [--refresh]`, `wp bake-all`
- `docs/BAKING.md` — pełen workflow

### Added — Wise People multi-tenant

- 9 industry presets
- Registry (clients.json), bulk-bake (concurrent + resumable), dashboard (HTML/MD/JSON), deploy helpers (rsync/git/sftp/manual)
- 8 nowych komend `wp init/industries/add-client/list/remove-client/bake-all/status/dashboard/deploy-all`
- `docs/WISE-PEOPLE.md` — agency workflow

## [1.0.0] — 2026-05-10 — Initial Release

### Added — Core

- 6-warstwowy auditor (indexability, schema, semantic_html, content, ai_files, performance)
- 14 schema templates (Tier 1-3)
- AI files generators: llms.txt, llms-full.txt, robots, sitemap, RSS, agent-card, skill.md, AGENTS.md, _headers, ai.txt
- MCP-over-HTTP server (6 tools, JSON-RPC 2.0, auth + rate limit)
- Runtime content negotiation (15 AI bot UA patterns)
- Citation monitor (ChatGPT/Perplexity/Claude/Gemini)
- Autofix (12+ fixers, iron law: zero destruktywnych zmian)
- 5 adapterów: Next.js, Express, Astro, vanilla/Workers, WordPress

### Added — Autopilot v1.0

- 15 modułów (keyword-research, rank-tracker, alt-generator, content-rewriter, internal-linking, broken-links, backlink-monitor, competitor-tracker, content-refresh, gsc-sync, psi-monitor, indexnow-push, hreflang-validator, canonical-validator, lighthouse-audit)
- SQLite storage
- Scheduler (cron + LaunchAgent)
- Markdown report aggregator
- CLI z 12 komendami

### Security hardening

- SSRF guard (DNS lookup + private IP block)
- XSS-safe schema serialization
- RSS CDATA injection guard
- WordPress: esc_url/esc_attr/esc_html
- MCP rate limit + Bearer auth
- DoS guard w regex (50k iter cap)
