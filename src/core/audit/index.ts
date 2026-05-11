/**
 * AuditEngine — 6-warstwowy audit każdej strony pod kątem cytowalności LLM.
 *
 * Warstwy (każda ma własny scorer + listę checków):
 *   1. indexability — czy AI w ogóle może wejść i przeczytać
 *   2. schema — czy JSON-LD jest, czy w Tier 1 (Org/WebSite/Article/Breadcrumb)
 *   3. semantic_html — main/article/section/header/nav hierarchy, h1 unikalność
 *   4. content — first-30%-answered, heading-query match, entity density, stats
 *   5. ai_files — llms.txt, robots.txt z AI bots, sitemap, feed.xml
 *   6. performance — LCP/CLS/INP via PageSpeed Insights (opcjonalnie)
 *
 * Filozofia: każdy finding ma:
 *   - status (pass/fail/warning/skip)
 *   - severity (critical → info)
 *   - citation z badania (skąd wiemy że to ma znaczenie)
 *   - autofixable + autofix-ref (jak naprawić bez review)
 *
 * Nie wykonujemy JavaScriptu — jeśli content jest tylko po hydration, dla
 * LLM go nie ma. To największa pułapka stron Next.js z `use client`.
 */

import type {
  AuditReport,
  AuditLayer,
  Finding,
  SiteToMcpConfig,
} from '../../types/index.js';
import {
  fetchAs,
  fetchAllBots,
  detectRendering,
  parse,
  extractMeta,
  extractJsonLd,
  listSchemaTypes,
  extractHeadings,
  extractMainText,
  firstNWords,
  wordCount,
} from '../utils/index.js';

export interface AuditOptions {
  /** Wpisany URL do audytu */
  url: string;
  /** Konfiguracja site-to-mcp (brand, AI bots, llms.txt path itd.) */
  config?: Partial<SiteToMcpConfig>;
  /** Czy testować dostępność stron pod różnymi AI user-agents (default true) */
  testAiBots?: boolean;
  /** Czy uderzać do PageSpeed Insights (wymaga klucza) */
  pagespeedApiKey?: string;
  /** Custom HTML — gdy mamy plik lokalnie (skip fetch) */
  rawHtml?: string;
  /** Verbose log */
  log?: (msg: string) => void;
}

export class AuditEngine {
  private log: (msg: string) => void;

  constructor(private opts: AuditOptions) {
    this.log = opts.log ?? (() => {});
  }

  async run(): Promise<AuditReport> {
    this.log(`[audit] start ${this.opts.url}`);
    const findings: Finding[] = [];

    // 1. Fetch (z różnymi UA jeśli testAiBots)
    const browserRes = this.opts.rawHtml
      ? {
          bot: 'Browser' as const,
          status: 200,
          contentType: 'text/html',
          bytes: this.opts.rawHtml.length,
          html: this.opts.rawHtml,
          headers: {},
          durationMs: 0,
        }
      : await fetchAs(this.opts.url, 'Browser');

    const html = browserRes.html;
    const $ = parse(html);
    const meta = extractMeta($);
    const rendering = detectRendering(html);

    // ====== LAYER 1: INDEXABILITY ======
    findings.push(...this.auditIndexability(browserRes, meta, rendering, $));

    // AI bots access test
    let aiBotAccess: Record<string, boolean> = {};
    if (this.opts.testAiBots !== false && !this.opts.rawHtml) {
      const botRes = await fetchAllBots(this.opts.url, ['GPTBot', 'ClaudeBot', 'PerplexityBot']);
      aiBotAccess = Object.fromEntries(botRes.map((r) => [r.bot, r.status >= 200 && r.status < 400]));
      findings.push(...this.auditAiBotAccess(botRes));
    }

    // ====== LAYER 2: SCHEMA ======
    const jsonLd = extractJsonLd($);
    const schemaTypes = listSchemaTypes(jsonLd);
    findings.push(...this.auditSchema(schemaTypes, jsonLd, meta));

    // ====== LAYER 3: SEMANTIC HTML ======
    findings.push(...this.auditSemanticHtml($));

    // ====== LAYER 4: CONTENT ======
    findings.push(...this.auditContent($, meta));

    // ====== LAYER 5: AI FILES ======
    if (!this.opts.rawHtml) {
      const aiFilesFindings = await this.auditAiFiles(this.opts.url);
      findings.push(...aiFilesFindings);
    }

    // ====== LAYER 6: PERFORMANCE ======
    if (this.opts.pagespeedApiKey && !this.opts.rawHtml) {
      try {
        const perfFindings = await this.auditPerformance(this.opts.url, this.opts.pagespeedApiKey);
        findings.push(...perfFindings);
      } catch (err) {
        this.log(`[audit] pagespeed failed: ${err}`);
      }
    }

    const scores = this.computeScores(findings);

    return {
      url: this.opts.url,
      timestamp: new Date().toISOString(),
      scores,
      findings,
      meta: {
        httpStatus: browserRes.status,
        contentType: browserRes.contentType,
        title: meta.title,
        description: meta.description,
        canonical: meta.canonical,
        lang: meta.lang,
        rendering,
        aiBotAccess,
      },
      rawHtml: html,
    };
  }

  // ==========================================================================
  // LAYER 1: INDEXABILITY
  // ==========================================================================

  private auditIndexability(
    res: { status: number; html: string; headers: Record<string, string> },
    meta: ReturnType<typeof extractMeta>,
    rendering: ReturnType<typeof detectRendering>,
    $: ReturnType<typeof parse>,
  ): Finding[] {
    const f: Finding[] = [];

    // HTTP status
    f.push({
      id: 'IDX-001',
      layer: 'indexability',
      status: res.status === 200 ? 'pass' : 'fail',
      severity: res.status === 200 ? 'info' : 'critical',
      title: 'HTTP status',
      detail: `Strona zwraca HTTP ${res.status}`,
      autofixable: false,
    });

    // Rendering (SSR vs CSR)
    f.push({
      id: 'IDX-002',
      layer: 'indexability',
      status: rendering === 'csr' ? 'fail' : 'pass',
      severity: rendering === 'csr' ? 'critical' : 'info',
      title: 'Rendering mode',
      detail:
        rendering === 'csr'
          ? 'Wykryto CSR — AI crawlery nie wykonują JavaScriptu. Content niewidoczny dla LLM.'
          : `Detected: ${rendering}`,
      citation:
        'Vercel 500M+ fetches 2026: AI crawlery (GPTBot, ClaudeBot, PerplexityBot) NIE wykonują JS. SSR/SSG = must-have.',
      autofixable: false,
      recommendation:
        rendering === 'csr'
          ? 'Przejdź na SSR/SSG (Next.js app router, Astro static, getServerSideProps).'
          : undefined,
      impact: rendering === 'csr' ? 95 : 0,
    });

    // Canonical
    if (!meta.canonical) {
      f.push({
        id: 'IDX-003',
        layer: 'indexability',
        status: 'warning',
        severity: 'medium',
        title: 'Brak canonical',
        detail: 'Strona nie ma <link rel="canonical">. Ryzyko duplicate content w oczach Google + LLM.',
        autofixable: true,
        autofix: {
          action: 'inject_canonical',
          args: { url: this.opts.url },
          risk: 'zero',
        },
      });
    } else {
      f.push({
        id: 'IDX-003',
        layer: 'indexability',
        status: 'pass',
        severity: 'info',
        title: 'Canonical obecny',
        detail: meta.canonical,
        autofixable: false,
      });
    }

    // Robots meta
    if (meta.robots && /noindex/i.test(meta.robots)) {
      f.push({
        id: 'IDX-004',
        layer: 'indexability',
        status: 'fail',
        severity: 'critical',
        title: 'noindex w meta',
        detail: `<meta name="robots"> zawiera noindex (${meta.robots}). Strona całkowicie wyłączona z wyszukiwarek.`,
        autofixable: true,
        autofix: {
          action: 'remove_noindex',
          args: {},
          risk: 'low',
        },
      });
    }

    // HTML lang
    if (!meta.lang) {
      f.push({
        id: 'IDX-005',
        layer: 'indexability',
        status: 'warning',
        severity: 'medium',
        title: 'Brak <html lang="...">',
        detail: 'Bez atrybutu lang LLM nie wie, w jakim języku jest strona.',
        autofixable: true,
        autofix: {
          action: 'set_html_lang',
          args: { lang: 'pl-PL' },
          risk: 'zero',
        },
      });
    }

    // Title length
    const titleLen = (meta.title ?? '').length;
    if (titleLen < 30 || titleLen > 65) {
      f.push({
        id: 'IDX-006',
        layer: 'indexability',
        status: 'warning',
        severity: 'low',
        title: `<title> długość: ${titleLen}`,
        detail: 'Title powinien mieć 50-60 znaków. Krótki = niewykorzystany potencjał, długi = ucięty.',
        autofixable: false,
      });
    }

    // Description
    if (!meta.description) {
      f.push({
        id: 'IDX-007',
        layer: 'indexability',
        status: 'warning',
        severity: 'medium',
        title: 'Brak meta description',
        detail: 'Bez meta description LLM często cytuje pierwszy paragraph - słaby fallback.',
        autofixable: false,
      });
    }

    // Mixed content (http:// na https://)
    if (this.opts.url.startsWith('https://')) {
      const httpAssets = ($('img, script, link[rel="stylesheet"]').toArray() as Array<{ attribs?: Record<string, string> }>)
        .map((el) => el.attribs?.src ?? el.attribs?.href ?? '')
        .filter((url) => url.startsWith('http://'));
      if (httpAssets.length > 0) {
        f.push({
          id: 'IDX-008',
          layer: 'indexability',
          status: 'fail',
          severity: 'high',
          title: `Mixed content: ${httpAssets.length} http:// assets`,
          detail: `Przeglądarki blokują, AI crawlery downgrade'ują zaufanie. Przykład: ${httpAssets[0]}`,
          autofixable: false,
        });
      }
    }

    return f;
  }

  // ==========================================================================
  // LAYER 1b: AI BOT ACCESS
  // ==========================================================================

  private auditAiBotAccess(botRes: Array<{ bot: string; status: number }>): Finding[] {
    const f: Finding[] = [];
    for (const r of botRes) {
      const ok = r.status >= 200 && r.status < 400;
      f.push({
        id: `IDX-BOT-${r.bot}`,
        layer: 'indexability',
        status: ok ? 'pass' : 'fail',
        severity: ok ? 'info' : 'high',
        title: `${r.bot} access`,
        detail: ok
          ? `${r.bot} otrzymał HTTP ${r.status}`
          : `${r.bot} dostał HTTP ${r.status} — blokada AI crawlera (Cloudflare/firewall?).`,
        citation:
          r.bot === 'ClaudeBot'
            ? 'Cloudflare Q1 2026: ClaudeBot 20,583 crawl / 1 referral. Bot który nie wejdzie = brak cytowania.'
            : undefined,
        autofixable: !ok,
        autofix: ok
          ? undefined
          : {
              action: 'whitelist_bot',
              args: { bot: r.bot },
              risk: 'low',
            },
      });
    }
    return f;
  }

  // ==========================================================================
  // LAYER 2: SCHEMA
  // ==========================================================================

  private auditSchema(
    types: string[],
    blocks: Array<{ parsed: unknown; error?: string }>,
    meta: ReturnType<typeof extractMeta>,
  ): Finding[] {
    const f: Finding[] = [];

    const TIER_1 = ['Organization', 'WebSite', 'BreadcrumbList'] as const;
    const has = (t: string) => types.includes(t);

    // Tier 1 — must-have
    for (const tier1 of TIER_1) {
      f.push({
        id: `SCH-T1-${tier1}`,
        layer: 'schema',
        status: has(tier1) ? 'pass' : 'fail',
        severity: has(tier1) ? 'info' : 'high',
        title: `Tier 1: ${tier1}`,
        detail: has(tier1)
          ? `${tier1} obecny`
          : `Brak ${tier1}. Tier 1 = obowiązkowy site-wide schema.`,
        citation: 'Rankeo 2026: JSON-LD = 3.2x więcej AI citations. Data World: schema podnosi GPT-4 accuracy 16%→54%.',
        autofixable: !has(tier1),
        autofix: has(tier1)
          ? undefined
          : {
              action: 'inject_schema',
              args: { type: tier1 },
              risk: 'zero',
            },
        impact: has(tier1) ? 0 : 60,
      });
    }

    // Article / BlogPosting / Product — typ zależny od strony
    const hasContentSchema =
      has('Article') ||
      has('BlogPosting') ||
      has('NewsArticle') ||
      has('Product') ||
      has('LocalBusiness') ||
      has('Service') ||
      has('Event') ||
      has('Recipe') ||
      has('HowTo') ||
      has('QAPage');
    f.push({
      id: 'SCH-PAGETYPE',
      layer: 'schema',
      status: hasContentSchema ? 'pass' : 'warning',
      severity: hasContentSchema ? 'info' : 'medium',
      title: 'Page-type schema',
      detail: hasContentSchema
        ? `Wykryto: ${types.filter((t) => /Article|Product|LocalBusiness|Service|Event|Recipe|HowTo|QAPage/i.test(t)).join(', ')}`
        : 'Brak schema typu strony (Article/Product/LocalBusiness/HowTo). Dodaj wg charakteru strony.',
      autofixable: false,
    });

    // FAQPage
    f.push({
      id: 'SCH-FAQ',
      layer: 'schema',
      status: has('FAQPage') ? 'pass' : 'warning',
      severity: 'low',
      title: 'FAQPage schema',
      detail: has('FAQPage')
        ? 'FAQPage obecny'
        : 'Brak FAQPage. Jeśli masz sekcję FAQ — dodaj (AEO + GEO boost).',
      citation: 'QAPage schema → 58% więcej ChatGPT citations niż Article (research 2025-2026).',
      autofixable: false,
    });

    // Person (autor)
    f.push({
      id: 'SCH-PERSON',
      layer: 'schema',
      status: has('Person') ? 'pass' : 'warning',
      severity: 'medium',
      title: 'Person (author) schema',
      detail: has('Person')
        ? 'Person obecny'
        : 'Brak schema Person dla autora. E-E-A-T fundament (Google Authors Section luty 2026).',
      autofixable: false,
    });

    // Speakable
    f.push({
      id: 'SCH-SPEAKABLE',
      layer: 'schema',
      status: has('SpeakableSpecification') ? 'pass' : 'warning',
      severity: 'low',
      title: 'SpeakableSpecification',
      detail: has('SpeakableSpecification')
        ? 'Speakable obecny'
        : 'Brak SpeakableSpecification. +127% voice search referrals (research 2026).',
      autofixable: true,
      autofix: has('SpeakableSpecification')
        ? undefined
        : {
            action: 'inject_schema',
            args: { type: 'SpeakableSpecification' },
            risk: 'zero',
          },
    });

    // JSON-LD parse errors
    const broken = blocks.filter((b) => b.error);
    if (broken.length > 0) {
      f.push({
        id: 'SCH-PARSE',
        layer: 'schema',
        status: 'fail',
        severity: 'high',
        title: `${broken.length} bloków JSON-LD ma błąd parse`,
        detail: 'Google Rich Results Test odrzuci. AI parsery również skip.',
        evidence: broken.map((b) => b.error),
        autofixable: false,
      });
    }

    return f;
  }

  // ==========================================================================
  // LAYER 3: SEMANTIC HTML
  // ==========================================================================

  private auditSemanticHtml($: ReturnType<typeof parse>): Finding[] {
    const f: Finding[] = [];

    const count = (sel: string) => $(sel).length;
    const counts = {
      main: count('main'),
      article: count('article'),
      section: count('section'),
      header: count('header'),
      footer: count('footer'),
      nav: count('nav'),
      aside: count('aside'),
      blockquote: count('blockquote'),
      h1: count('h1'),
      h2: count('h2'),
      h3: count('h3'),
    };

    // H1 unikalność
    if (counts.h1 === 0) {
      f.push({
        id: 'SEM-H1-MISSING',
        layer: 'semantic_html',
        status: 'fail',
        severity: 'high',
        title: 'Brak <h1>',
        detail: 'Każda strona musi mieć dokładnie jeden <h1>. LLM bez H1 nie wie co jest tematem strony.',
        autofixable: false,
      });
    } else if (counts.h1 > 1) {
      f.push({
        id: 'SEM-H1-MANY',
        layer: 'semantic_html',
        status: 'fail',
        severity: 'high',
        title: `${counts.h1} elementów <h1>`,
        detail: 'Strona powinna mieć dokładnie jeden <h1>. Wiele H1 = mieszany sygnał głównego tematu.',
        autofixable: false,
      });
    } else {
      f.push({
        id: 'SEM-H1-OK',
        layer: 'semantic_html',
        status: 'pass',
        severity: 'info',
        title: 'H1 unikalny',
        detail: $('h1').first().text().trim(),
        autofixable: false,
      });
    }

    // <main>
    f.push({
      id: 'SEM-MAIN',
      layer: 'semantic_html',
      status: counts.main === 1 ? 'pass' : counts.main === 0 ? 'fail' : 'warning',
      severity: counts.main === 0 ? 'high' : 'low',
      title: `<main>: ${counts.main}`,
      detail:
        counts.main === 0
          ? 'Brak <main>. AI heurystyka "extract main content" gubi się.'
          : counts.main > 1
            ? 'Więcej niż jeden <main> = niewłaściwe.'
            : '<main> obecny',
      autofixable: counts.main !== 1,
      autofix:
        counts.main === 1
          ? undefined
          : {
              action: 'wrap_in_main',
              args: {},
              risk: 'medium',
            },
    });

    // <article>
    f.push({
      id: 'SEM-ARTICLE',
      layer: 'semantic_html',
      status: counts.article >= 1 ? 'pass' : 'warning',
      severity: 'medium',
      title: `<article>: ${counts.article}`,
      detail:
        counts.article === 0
          ? 'Brak <article>. Treść właściwą warto opakować — dom-to-semantic-markdown używa <article> jako boundary.'
          : `${counts.article} elementów <article>`,
      autofixable: counts.article === 0,
      autofix:
        counts.article === 0
          ? {
              action: 'wrap_in_article',
              args: {},
              risk: 'low',
            }
          : undefined,
    });

    // <blockquote>
    f.push({
      id: 'SEM-BLOCKQUOTE',
      layer: 'semantic_html',
      status: counts.blockquote >= 1 ? 'pass' : 'warning',
      severity: 'low',
      title: `<blockquote>: ${counts.blockquote}`,
      detail:
        counts.blockquote === 0
          ? 'Brak <blockquote>. Cytaty = 4.1 vs 2.4 citations avg (research).'
          : `${counts.blockquote} cytatów`,
      citation: 'Search Engine Journal: expert quotes = 4.1 vs 2.4 AI citations avg.',
      autofixable: false,
    });

    return f;
  }

  // ==========================================================================
  // LAYER 4: CONTENT
  // ==========================================================================

  private auditContent($: ReturnType<typeof parse>, meta: ReturnType<typeof extractMeta>): Finding[] {
    const f: Finding[] = [];
    const mainText = extractMainText($);
    const wc = wordCount(mainText);
    const headings = extractHeadings($);
    const h2plus = headings.filter((h) => h.level >= 2 && h.level <= 3);
    const questions = h2plus.filter((h) => h.isQuestion).length;
    const h3Questions = headings.filter((h) => h.level === 3 && h.isQuestion).length;
    const h3Total = headings.filter((h) => h.level === 3).length;
    const h3QuestionsPct = h3Total === 0 ? 0 : Math.round((h3Questions / h3Total) * 100);

    // Word count
    f.push({
      id: 'CNT-WC',
      layer: 'content',
      status: wc >= 500 && wc <= 2000 ? 'pass' : wc < 300 ? 'fail' : 'warning',
      severity: wc < 300 ? 'high' : 'low',
      title: `Word count: ${wc}`,
      detail:
        wc < 300
          ? 'Bardzo cienka treść. <300 słów rzadko cytowane.'
          : wc > 5000
            ? '>5000 słów: gorsze cytowanie niż 500-2000 (research).'
            : `${wc} słów`,
      citation: 'aiboost.co.uk: pages 500-2000 słów performują najlepiej. >5000 gorzej niż <500.',
      autofixable: false,
    });

    // First-30%-answered
    const first30Pct = firstNWords(mainText, Math.max(60, Math.floor(wc * 0.3)));
    const answered = /\d|jak|to jest|odpowied|polega|znajdziesz|here is|the answer|consists|means/i.test(first30Pct);
    f.push({
      id: 'CNT-30PCT',
      layer: 'content',
      status: answered ? 'pass' : 'warning',
      severity: answered ? 'info' : 'high',
      title: 'Odpowiedź w pierwszych 30%',
      detail: answered
        ? 'Pierwsze 30% treści zawiera odpowiedź/konkret.'
        : 'Pierwsze 30% to wprowadzenie/marketing. Przenieś konkret na górę.',
      citation: 'Indig 30M citations: 44.2% wszystkich citations z pierwszych 30% treści.',
      autofixable: false,
      impact: answered ? 0 : 80,
    });

    // Heading-query match (heading = pytanie)
    f.push({
      id: 'CNT-HQ-MATCH',
      layer: 'content',
      status: questions / Math.max(h2plus.length, 1) >= 0.5 ? 'pass' : 'warning',
      severity: 'medium',
      title: `${questions}/${h2plus.length} nagłówków = pytania`,
      detail: `Headings z pytaniami: 78.4% cited content (Indig). H3 questions: ${h3QuestionsPct}%.`,
      citation: 'Search Engine Land: heading-query match = 41% citation rate (najsilniejszy on-page factor).',
      autofixable: false,
      impact: 50,
    });

    // Question marks w treści
    const qMarks = (mainText.match(/\?/g) ?? []).length;
    f.push({
      id: 'CNT-QMARKS',
      layer: 'content',
      status: qMarks >= 3 ? 'pass' : 'warning',
      severity: 'low',
      title: `Question marks: ${qMarks}`,
      detail: 'Pytania w treści 2x częściej cytowane (Surfer SEO, Onely).',
      autofixable: false,
    });

    // Stats / liczby
    const stats = (mainText.match(/\d+[%.,]\d+|\d+%|\d{4,}/g) ?? []).length;
    f.push({
      id: 'CNT-STATS',
      layer: 'content',
      status: stats >= 5 ? 'pass' : 'warning',
      severity: 'medium',
      title: `Stats/liczby: ${stats}`,
      detail: '19+ stat points = 5.4 vs 2.8 citations avg (wellows.com).',
      autofixable: false,
      impact: stats < 3 ? 40 : 0,
    });

    // Entity density (uproszczona — liczy capitalized words)
    const tokens = mainText.split(/\s+/u).filter((t) => /[\p{L}]/u.test(t));
    const properNouns = tokens.filter((t) => /^[A-ZŁŚŻŹĆĄĘÓŃ][\p{L}-]+$/u.test(t)).length;
    const entityDensity = tokens.length === 0 ? 0 : (properNouns / tokens.length) * 100;
    f.push({
      id: 'CNT-ENTITY',
      layer: 'content',
      status: entityDensity >= 15 ? 'pass' : 'warning',
      severity: 'medium',
      title: `Entity density: ${entityDensity.toFixed(1)}%`,
      detail: 'Cytowane treści mają entity density ~20.6% (Indig). Norma to 5-8%.',
      autofixable: false,
    });

    // OG image / hero image
    if (!meta.ogImage) {
      f.push({
        id: 'CNT-OG-IMG',
        layer: 'content',
        status: 'warning',
        severity: 'low',
        title: 'Brak og:image',
        detail: 'Bez og:image link do strony w social/AI Mode jest mniej atrakcyjny.',
        autofixable: false,
      });
    }

    // Date published / modified
    if (!meta.publishedTime && !meta.modifiedTime) {
      f.push({
        id: 'CNT-DATES',
        layer: 'content',
        status: 'warning',
        severity: 'medium',
        title: 'Brak datePublished/dateModified',
        detail: 'AI cytuje 25.7% częściej content "fresher" — bez daty system nie wie czy świeży.',
        autofixable: false,
      });
    }

    return f;
  }

  // ==========================================================================
  // LAYER 5: AI FILES
  // ==========================================================================

  private async auditAiFiles(baseUrl: string): Promise<Finding[]> {
    const base = new URL(baseUrl);
    const checks = [
      { name: 'robots.txt', path: '/robots.txt', critical: true },
      { name: 'sitemap.xml', path: '/sitemap.xml', critical: true },
      { name: 'llms.txt', path: '/llms.txt', critical: false },
      { name: 'llms-full.txt', path: '/llms-full.txt', critical: false },
      { name: 'feed.xml', path: '/feed.xml', critical: false },
      { name: '.well-known/mcp.json', path: '/.well-known/mcp.json', critical: false },
      { name: '.well-known/agent-card.json', path: '/.well-known/agent-card.json', critical: false },
      { name: 'skill.md', path: '/skill.md', critical: false },
    ];

    // Parallel: 8 HEAD requestów = ~200ms zamiast 8x100-500ms sequential
    const results = await Promise.all(
      checks.map(async (c) => {
        const url = `${base.origin}${c.path}`;
        try {
          const res = await fetch(url, { method: 'HEAD' });
          return { check: c, url, status: res.status, ok: res.status >= 200 && res.status < 400 };
        } catch (err) {
          return { check: c, url, status: 0, ok: false, error: String(err) };
        }
      }),
    );

    const f: Finding[] = results.map((r) => ({
      id: `FILE-${r.check.name}`,
      layer: 'ai_files' as const,
      status: r.ok ? ('pass' as const) : r.check.critical ? ('fail' as const) : ('warning' as const),
      severity: r.ok ? ('info' as const) : r.check.critical ? ('high' as const) : ('low' as const),
      title: `${r.check.name}: HTTP ${r.status}`,
      detail: r.ok ? `${r.check.name} dostępny` : `Brak ${r.check.name}`,
      autofixable: !r.ok,
      ...(r.ok
        ? {}
        : {
            autofix: {
              action: 'generate_file',
              args: { file: r.check.name, path: r.check.path },
              risk: 'zero' as const,
            },
          }),
    }));

    // robots.txt deep-check (jeden dodatkowy GET, w paralelu z resztą tym razem skipujemy bo logicznie zależy)
    const robotsResult = results.find((r) => r.check.name === 'robots.txt');
    if (robotsResult?.ok) {
      try {
        const txt = await fetch(robotsResult.url).then((r) => r.text());
        const aiBots = ['GPTBot', 'ClaudeBot', 'PerplexityBot', 'Google-Extended', 'AppleBot', 'OAI-SearchBot', 'Claude-SearchBot'];
        for (const bot of aiBots) {
          const disallowed = new RegExp(`User-agent:\\s*${bot}[\\s\\S]*?Disallow:\\s*/\\s*$`, 'im').test(txt);
          f.push({
            id: `FILE-robots-${bot}`,
            layer: 'ai_files',
            status: disallowed ? 'fail' : 'pass',
            severity: disallowed ? 'high' : 'info',
            title: `robots.txt allows ${bot}`,
            detail: disallowed
              ? `${bot} zablokowany w robots.txt — żadne cytowanie nie będzie możliwe.`
              : `${bot} ma dostęp.`,
            autofixable: disallowed,
            ...(disallowed
              ? {
                  autofix: { action: 'allow_bot_in_robots', args: { bot }, risk: 'low' as const },
                }
              : {}),
          });
        }
      } catch {
        // robots.txt fetch failed - already logged in HEAD check
      }
    }

    return f;
  }

  // ==========================================================================
  // LAYER 6: PERFORMANCE (PageSpeed)
  // ==========================================================================

  private async auditPerformance(url: string, apiKey: string): Promise<Finding[]> {
    const f: Finding[] = [];
    const psiUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&strategy=mobile&category=performance&key=${apiKey}`;
    const res = await fetch(psiUrl);
    if (!res.ok) {
      f.push({
        id: 'PERF-ERR',
        layer: 'performance',
        status: 'skip',
        severity: 'low',
        title: 'PageSpeed Insights niedostępne',
        detail: `HTTP ${res.status}`,
        autofixable: false,
      });
      return f;
    }
    const json = (await res.json()) as {
      loadingExperience?: { metrics?: Record<string, { percentile?: number }> };
    };
    const m = json.loadingExperience?.metrics ?? {};
    const lcp = m['LARGEST_CONTENTFUL_PAINT_MS']?.percentile;
    const cls = m['CUMULATIVE_LAYOUT_SHIFT_SCORE']?.percentile;
    const inp = m['INTERACTION_TO_NEXT_PAINT']?.percentile;

    if (typeof lcp === 'number') {
      f.push({
        id: 'PERF-LCP',
        layer: 'performance',
        status: lcp <= 2500 ? 'pass' : 'fail',
        severity: lcp > 4000 ? 'high' : 'medium',
        title: `LCP: ${lcp}ms`,
        detail: 'LCP < 2500ms wymagane (Core Web Vitals).',
        autofixable: false,
        citation: 'LCP >3s = -23% traffic loss.',
      });
    }
    if (typeof cls === 'number') {
      const clsVal = cls / 100; // PSI normalizes to *100
      f.push({
        id: 'PERF-CLS',
        layer: 'performance',
        status: clsVal <= 0.1 ? 'pass' : 'fail',
        severity: clsVal > 0.25 ? 'high' : 'medium',
        title: `CLS: ${clsVal.toFixed(3)}`,
        detail: 'CLS < 0.1 wymagane.',
        autofixable: false,
      });
    }
    if (typeof inp === 'number') {
      f.push({
        id: 'PERF-INP',
        layer: 'performance',
        status: inp <= 200 ? 'pass' : 'fail',
        severity: inp > 500 ? 'high' : 'medium',
        title: `INP: ${inp}ms`,
        detail: 'INP < 200ms wymagane.',
        autofixable: false,
      });
    }

    return f;
  }

  // ==========================================================================
  // SCORING
  // ==========================================================================

  private computeScores(findings: Finding[]): Record<AuditLayer | 'overall', number> {
    const layers: AuditLayer[] = [
      'indexability',
      'schema',
      'semantic_html',
      'content',
      'ai_files',
      'performance',
    ];
    const result: Record<string, number> = {};

    for (const l of layers) {
      const layerFindings = findings.filter((x) => x.layer === l && x.status !== 'skip');
      if (layerFindings.length === 0) {
        result[l] = 0;
        continue;
      }
      const weight: Record<string, number> = {
        critical: 25,
        high: 15,
        medium: 8,
        low: 3,
        info: 0,
      };
      let totalPenalty = 0;
      let maxPenalty = 0;
      for (const f of layerFindings) {
        const w = weight[f.severity] ?? 0;
        maxPenalty += w;
        if (f.status === 'fail') totalPenalty += w;
        if (f.status === 'warning') totalPenalty += w / 2;
      }
      const score = maxPenalty === 0 ? 100 : Math.max(0, Math.round(100 - (totalPenalty / maxPenalty) * 100));
      result[l] = score;
    }

    const overall = Math.round(
      (result['indexability'] ?? 0) * 0.2 +
        (result['schema'] ?? 0) * 0.2 +
        (result['semantic_html'] ?? 0) * 0.1 +
        (result['content'] ?? 0) * 0.3 +
        (result['ai_files'] ?? 0) * 0.15 +
        (result['performance'] ?? 0) * 0.05,
    );
    result['overall'] = overall;

    return result as Record<AuditLayer | 'overall', number>;
  }
}

export async function audit(opts: AuditOptions): Promise<AuditReport> {
  return new AuditEngine(opts).run();
}
