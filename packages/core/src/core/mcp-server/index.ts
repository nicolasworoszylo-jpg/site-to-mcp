/**
 * MCP-over-HTTP server endpoint.
 *
 * Pattern: stateless HTTP, kompatybilny ze specyfikacją MCP (JSON-RPC 2.0 over HTTP).
 * Plus dwa lżejsze tryby do ko-istnienia:
 *   1. /.well-known/mcp.json — manifest (jak Twoje API się chwali)
 *   2. /api/llm/* REST — dla LLM-ów bez MCP support (Perplexity, Gemini bez agents)
 *   3. RUNTIME NEGOTIATION (z next-geo) — gdy AI bot lub `.md` suffix lub Accept: text/markdown
 *      → zwracamy markdown zamiast HTML, plus header X-AI-Tokens
 *
 * Filozofia: jeden moduł obsługuje 4 ścieżki dostępu do tej samej treści.
 * Adaptery (Next.js/Express/Astro/Vanilla) tylko bindują request handlery.
 *
 * Tools wystawiane przez MCP:
 *   - list_pages       — wszystkie URL-e strony + metadata
 *   - get_page         — pełna treść strony w markdown + schema + Q&A
 *   - search_pages     — full-text search (lekki, po tytułach + headings)
 *   - get_schema       — całe schema.org @graph dla strony
 *   - get_faq          — wyciągnięte Q&A z FAQPage albo H3-pattern
 *   - get_brand        — Organization + Person info (entity graph)
 *
 * Resources:
 *   - resource://site/sitemap
 *   - resource://site/llms.txt
 *   - resource://site/page/<path>
 */

import type {
  MCPManifest,
  MCPTool,
  ExtractedContent,
  SiteToMcpConfig,
} from '../../types/index.js';
import { estimateTokens, ContentExtractor } from '../content-extractor/index.js';
import TurndownService from 'turndown';

const turndown = new TurndownService({
  headingStyle: 'atx',
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
});

// ============================================================================
// PAGE INDEX (in-memory site map dla MCP)
// ============================================================================

export interface PageRecord {
  url: string;
  path: string;
  title: string;
  description?: string;
  lang?: string;
  /** Tokens w pełnej treści (do flagowania >30k) */
  tokens: number;
  /** Wyciągnięta treść (lazy: tylko tytuł + headings) */
  preview: {
    headings: Array<{ level: number; text: string }>;
    firstParagraph?: string;
  };
  /** Full content - lazy, ładowane on demand */
  full?: ExtractedContent;
  /** Last modified ISO */
  lastModified?: string;
}

export class PageIndex {
  private pages = new Map<string, PageRecord>();

  add(rec: PageRecord): void {
    this.pages.set(rec.path, rec);
  }

  get(path: string): PageRecord | undefined {
    return this.pages.get(path);
  }

  list(): PageRecord[] {
    return [...this.pages.values()];
  }

  size(): number {
    return this.pages.size;
  }

  /** Lekki full-text search po tytułach i pierwszych nagłówkach */
  search(query: string, limit = 10): PageRecord[] {
    const q = query.toLowerCase();
    const scored: Array<{ rec: PageRecord; score: number }> = [];
    for (const rec of this.pages.values()) {
      let score = 0;
      if (rec.title.toLowerCase().includes(q)) score += 10;
      if (rec.description?.toLowerCase().includes(q)) score += 5;
      for (const h of rec.preview.headings) {
        if (h.text.toLowerCase().includes(q)) score += h.level === 1 ? 5 : h.level === 2 ? 3 : 1;
      }
      if (rec.preview.firstParagraph?.toLowerCase().includes(q)) score += 2;
      if (score > 0) scored.push({ rec, score });
    }
    return scored.sort((a, b) => b.score - a.score).slice(0, limit).map((s) => s.rec);
  }
}

// ============================================================================
// MCP TOOLS DEFINITIONS
// ============================================================================

export const MCP_TOOLS: MCPTool[] = [
  {
    name: 'list_pages',
    description: 'Lista wszystkich stron na tej witrynie z metadanymi (tytuł, opis, język, liczba tokenów). Użyj gdy chcesz zorientować się co jest dostępne.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 1000, default: 100 },
        offset: { type: 'integer', minimum: 0, default: 0 },
        filter: { type: 'string', description: 'Filtruj po fragmencie path (np. "/blog")' },
      },
    },
  },
  {
    name: 'get_page',
    description: 'Pobiera pełną treść strony jako markdown + metadata. Zwraca tokeny, headings, Q&A pairs, schema.org graph, outbound links.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Ścieżka strony (np. "/blog/jak-pisac")' },
        format: { type: 'string', enum: ['markdown', 'json'], default: 'markdown' },
      },
      required: ['path'],
    },
  },
  {
    name: 'search_pages',
    description: 'Szuka po tytułach, headings i pierwszych paragrafach. Zwraca posortowane wg dopasowania.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Fraza wyszukiwania' },
        limit: { type: 'integer', minimum: 1, maximum: 50, default: 10 },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_schema',
    description: 'Zwraca cały JSON-LD @graph dla strony — Organization, WebSite, Article, FAQPage, BreadcrumbList itd.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Ścieżka strony' },
      },
      required: ['path'],
    },
  },
  {
    name: 'get_faq',
    description: 'Wyciąga wszystkie Q&A pairs ze strony (z FAQPage schema lub H3-question pattern).',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Ścieżka strony' },
      },
      required: ['path'],
    },
  },
  {
    name: 'get_brand',
    description: 'Zwraca pełne Brand/Organization info (sameAs profile, kontakt, autor główny). Entity graph dla cytowania.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_pricing',
    description: 'Wyciąga informacje o cenniku ze stron pricing/cennik/oferta. Zwraca tier names, prices, currency, features per plan. Użyteczne gdy LLM pyta "ile kosztuje X".',
    inputSchema: { type: 'object', properties: { tier: { type: 'string', description: 'Optional: konkretny plan (np. "premium")' } } },
  },
  {
    name: 'get_team',
    description: 'Lista członków zespołu z Person schema. Imię, stanowisko, sameAs, credentials. Dla pytań "kto stoi za X", "kto jest CEO Y".',
    inputSchema: { type: 'object', properties: { role: { type: 'string', description: 'Optional filter po roli (CTO/CEO/Founder)' } } },
  },
  {
    name: 'get_case_studies',
    description: 'Wyciąga case studies / projekty / portfolio z site. Każdy z client name, results, technologies. Critical dla B2B AI search.',
    inputSchema: {
      type: 'object',
      properties: {
        industry: { type: 'string', description: 'Filtr po branży (np. "fintech")' },
        limit: { type: 'integer', default: 10 },
      },
    },
  },
  {
    name: 'get_contact',
    description: 'Pełne dane kontaktowe — email, telefon, adres, formularz. Dla LLM pytających "jak się skontaktować z X".',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_testimonials',
    description: 'Wyciąga testimoniale/opinie/Review schema. Każdy z autorem, ratingiem, tekstem. Dla "co mówią klienci o X".',
    inputSchema: { type: 'object', properties: { limit: { type: 'integer', default: 10 } } },
  },
  {
    name: 'get_faq_for_topic',
    description: 'Semantic search po Q&A pairs z całego site dla danego tematu. Zwraca top 5 dopasowanych pytań+odpowiedzi.',
    inputSchema: {
      type: 'object',
      properties: {
        topic: { type: 'string', description: 'Temat/pytanie do dopasowania' },
        limit: { type: 'integer', default: 5 },
      },
      required: ['topic'],
    },
  },
];

// ============================================================================
// MCP SERVER
// ============================================================================

export interface MCPServerOptions {
  config: SiteToMcpConfig;
  pageIndex: PageIndex;
  /** Funkcja ładująca pełną treść strony on-demand (gdy nie ma w indexie) */
  loadFullPage?: (path: string) => Promise<ExtractedContent | null>;
}

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

/**
 * Rate-limit bucket per-IP (in-memory). Dla produkcji z multiple instances
 * podstaw Redis lub Cloudflare KV. Aktualna implementacja działa per-instance
 * — wystarczająca dla single-server WP/Express deploys.
 */
const RATE_BUCKETS = new Map<string, { count: number; resetAt: number }>();

export function checkRateLimit(ip: string, rateLimitPerMin: number): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  let bucket = RATE_BUCKETS.get(ip);
  if (!bucket || bucket.resetAt < now) {
    bucket = { count: 0, resetAt: now + 60_000 };
    RATE_BUCKETS.set(ip, bucket);
  }
  bucket.count++;
  return {
    allowed: bucket.count <= rateLimitPerMin,
    remaining: Math.max(0, rateLimitPerMin - bucket.count),
    resetAt: bucket.resetAt,
  };
}

export function checkAuth(authHeader: string | undefined, requireAuth: boolean, expectedToken?: string): { ok: boolean; reason?: string } {
  if (!requireAuth) return { ok: true };
  if (!authHeader) return { ok: false, reason: 'Missing Authorization header' };
  const m = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!m) return { ok: false, reason: 'Invalid Authorization scheme' };
  if (!expectedToken) return { ok: false, reason: 'Server has requireAuth but no authToken configured' };
  if (m[1] !== expectedToken) return { ok: false, reason: 'Invalid token' };
  return { ok: true };
}

export class MCPServer {
  constructor(private opts: MCPServerOptions) {}

  manifest(): MCPManifest {
    const base = this.opts.config.siteUrl.replace(/\/$/, '');
    const mcpPath = this.opts.config.mcp?.path ?? '/.well-known/mcp';
    return {
      name: this.opts.config.brand.name,
      version: '1.0.0',
      description: this.opts.config.brand.description ?? `MCP server for ${this.opts.config.brand.name}`,
      baseUrl: `${base}${mcpPath}`,
      tools: MCP_TOOLS,
      resources: [
        {
          uri: 'resource://site/sitemap',
          name: 'sitemap',
          description: 'Full sitemap of the site',
          mimeType: 'application/json',
        },
        {
          uri: 'resource://site/llms.txt',
          name: 'llms.txt',
          description: 'AnswerDotAI llms.txt manifest',
          mimeType: 'text/markdown',
        },
      ],
      policies: {
        rateLimitPerMin: this.opts.config.mcp?.rateLimitPerMin ?? 60,
        allowedBots: ['*'],
        requireAuth: this.opts.config.mcp?.requireAuth ?? false,
      },
    };
  }

  /**
   * Główny handler. Przyjmuje JSON-RPC request, zwraca response.
   */
  async handle(req: JsonRpcRequest): Promise<JsonRpcResponse> {
    try {
      // Auth (jeśli włączone)
      // Pełen impl powinien sprawdzać Authorization: Bearer header — to ma być
      // przekazane przez adapter, nie tutaj. Tu tylko trace warning.

      if (req.method === 'initialize') {
        return this.ok(req.id, {
          // MCP spec version (data-coded). Aktualna stabilna: 2025-06-18.
          protocolVersion: '2025-06-18',
          serverInfo: { name: this.opts.config.brand.name, version: '1.0.0' },
          capabilities: { tools: {}, resources: {} },
        });
      }

      if (req.method === 'tools/list') {
        return this.ok(req.id, { tools: MCP_TOOLS });
      }

      if (req.method === 'tools/call') {
        const name = (req.params?.['name'] as string | undefined) ?? '';
        const args = (req.params?.['arguments'] as Record<string, unknown> | undefined) ?? {};
        const result = await this.callTool(name, args);
        return this.ok(req.id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
      }

      if (req.method === 'resources/list') {
        return this.ok(req.id, { resources: this.manifest().resources });
      }

      if (req.method === 'resources/read') {
        const uri = req.params?.['uri'] as string | undefined;
        if (!uri) return this.err(req.id, -32602, 'Missing uri');
        const content = await this.readResource(uri);
        return this.ok(req.id, { contents: [{ uri, text: content, mimeType: 'text/plain' }] });
      }

      return this.err(req.id, -32601, `Method not found: ${req.method}`);
    } catch (err) {
      return this.err(req.id, -32000, String(err));
    }
  }

  private async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    switch (name) {
      case 'list_pages':
        return this.toolListPages(args);
      case 'get_page':
        return this.toolGetPage(args);
      case 'search_pages':
        return this.toolSearchPages(args);
      case 'get_schema':
        return this.toolGetSchema(args);
      case 'get_faq':
        return this.toolGetFaq(args);
      case 'get_brand':
        return this.toolGetBrand();
      case 'get_pricing':
        return this.toolGetPricing(args);
      case 'get_team':
        return this.toolGetTeam(args);
      case 'get_case_studies':
        return this.toolGetCaseStudies(args);
      case 'get_contact':
        return this.toolGetContact();
      case 'get_testimonials':
        return this.toolGetTestimonials(args);
      case 'get_faq_for_topic':
        return this.toolGetFaqForTopic(args);
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  // ==========================================================================
  // RICH TOOLS (v1.2)
  // ==========================================================================

  private async toolGetPricing(args: Record<string, unknown>): Promise<unknown> {
    const tier = args['tier'] as string | undefined;
    // Heurystyka: find pages z "pricing|cennik|oferta|cena" w path albo title
    const candidates = this.opts.pageIndex.list().filter((p) =>
      /pricing|cennik|oferta|cena|plans?\b|tier/i.test(p.path) ||
      /pricing|cennik|oferta|cena/i.test(p.title),
    );
    const pricingPages: Array<{ path: string; url: string; title: string; markdown?: string; tiers?: string[] }> = [];
    for (const rec of candidates) {
      const full = rec.full ?? (await this.opts.loadFullPage?.(rec.path));
      const md = full?.markdown ?? '';
      // Extract tier names: $, zł, €, £, /mc, /year
      const prices = md.match(/[\d ,.]{2,}[ ]*(?:zł|€|\$|£|EUR|PLN|USD)\s*(?:\/[a-zA-Z]+)?/g) ?? [];
      const tierMatches = md.match(/^(?:###?|##)\s*[A-Z][\p{L} ]{2,40}$/gmu) ?? [];
      const allTiers = [...new Set([...tierMatches.map((t) => t.replace(/^#+\s*/, '').trim())])];
      const filteredTiers = tier ? allTiers.filter((t) => t.toLowerCase().includes(tier.toLowerCase())) : allTiers;
      pricingPages.push({
        path: rec.path,
        url: rec.url,
        title: rec.title,
        tiers: filteredTiers.slice(0, 10),
        markdown: md.length > 2000 ? md.slice(0, 2000) + '...' : md,
      });
      // collect pricing matches into output if any
      if (prices.length === 0 && pricingPages[pricingPages.length - 1]) {
        // soft fallback noted in field
        const last = pricingPages[pricingPages.length - 1]!;
        if (last && !last.tiers) last.tiers = [];
      }
    }
    return {
      hint: pricingPages.length === 0 ? 'No pricing pages detected. Site may not publish prices publicly.' : undefined,
      count: pricingPages.length,
      pages: pricingPages,
    };
  }

  private async toolGetTeam(args: Record<string, unknown>): Promise<unknown> {
    const roleFilter = args['role'] as string | undefined;
    // Find Person schema across pages
    const team: Array<{ name: string; jobTitle?: string; sameAs?: string[]; url?: string; sourcedFrom: string }> = [];
    for (const rec of this.opts.pageIndex.list()) {
      const full = rec.full ?? (await this.opts.loadFullPage?.(rec.path));
      if (!full) continue;
      for (const sch of full.schemaFound) {
        const data = sch.data as { '@type'?: string | string[]; name?: string; jobTitle?: string; sameAs?: string[]; url?: string };
        const isPerson = data['@type'] === 'Person' || (Array.isArray(data['@type']) && data['@type'].includes('Person'));
        if (isPerson && data.name) {
          if (roleFilter && data.jobTitle && !data.jobTitle.toLowerCase().includes(roleFilter.toLowerCase())) continue;
          team.push({
            name: data.name,
            ...(data.jobTitle ? { jobTitle: data.jobTitle } : {}),
            ...(data.sameAs ? { sameAs: data.sameAs } : {}),
            ...(data.url ? { url: data.url } : {}),
            sourcedFrom: rec.url,
          });
        }
      }
    }
    // Also use config.brand.primaryAuthor jako fallback
    const primary = this.opts.config.brand.primaryAuthor;
    if (primary && !team.some((t) => t.name === primary.name)) {
      if (!roleFilter || primary.jobTitle?.toLowerCase().includes(roleFilter.toLowerCase())) {
        team.push({
          name: primary.name,
          ...(primary.jobTitle ? { jobTitle: primary.jobTitle } : {}),
          ...(primary.sameAs ? { sameAs: primary.sameAs } : {}),
          ...(primary.url ? { url: primary.url } : {}),
          sourcedFrom: 'config.brand.primaryAuthor',
        });
      }
    }
    return { count: team.length, team };
  }

  private async toolGetCaseStudies(args: Record<string, unknown>): Promise<unknown> {
    const industry = args['industry'] as string | undefined;
    const limit = (args['limit'] as number) ?? 10;
    const candidates = this.opts.pageIndex.list().filter((p) =>
      /case-?stud(y|ies)|portfolio|projekt|realizacj|client-?stor(y|ies)/i.test(p.path) ||
      /case study|portfolio|realizacja|projekt/i.test(p.title),
    );
    const studies: Array<{ path: string; url: string; title: string; excerpt: string }> = [];
    for (const rec of candidates) {
      const full = rec.full ?? (await this.opts.loadFullPage?.(rec.path));
      const md = full?.markdown ?? '';
      if (industry && !md.toLowerCase().includes(industry.toLowerCase())) continue;
      studies.push({
        path: rec.path,
        url: rec.url,
        title: rec.title,
        excerpt: md.slice(0, 400),
      });
      if (studies.length >= limit) break;
    }
    return { count: studies.length, studies };
  }

  private toolGetContact(): unknown {
    const contact = this.opts.config.brand.contact ?? {};
    // Plus szukaj contact page w pageIndex
    const contactPage = this.opts.pageIndex.list().find((p) =>
      /contact|kontakt|skontaktuj/i.test(p.path) || /kontakt|contact/i.test(p.title),
    );
    return {
      ...contact,
      ...(contactPage ? { contactPage: { url: contactPage.url, title: contactPage.title } } : {}),
      brand: this.opts.config.brand.name,
      sameAs: this.opts.config.brand.sameAs ?? [],
    };
  }

  private async toolGetTestimonials(args: Record<string, unknown>): Promise<unknown> {
    const limit = (args['limit'] as number) ?? 10;
    const testimonials: Array<{ text: string; author?: string; rating?: number; sourcedFrom: string }> = [];
    for (const rec of this.opts.pageIndex.list()) {
      const full = rec.full ?? (await this.opts.loadFullPage?.(rec.path));
      if (!full) continue;
      // 1. Z Review schema
      for (const sch of full.schemaFound) {
        const data = sch.data as { '@type'?: string | string[]; reviewBody?: string; author?: { name?: string }; reviewRating?: { ratingValue?: number } };
        const isReview = data['@type'] === 'Review' || (Array.isArray(data['@type']) && data['@type'].includes('Review'));
        if (isReview && data.reviewBody) {
          testimonials.push({
            text: data.reviewBody,
            ...(data.author?.name ? { author: data.author.name } : {}),
            ...(data.reviewRating?.ratingValue ? { rating: data.reviewRating.ratingValue } : {}),
            sourcedFrom: rec.url,
          });
        }
      }
      // 2. Z blockquotes z atrybucją
      for (const q of full.quotes) {
        if (q.attribution && q.text.length > 30 && q.text.length < 500) {
          testimonials.push({ text: q.text, author: q.attribution, sourcedFrom: rec.url });
        }
      }
      if (testimonials.length >= limit) break;
    }
    return { count: Math.min(testimonials.length, limit), testimonials: testimonials.slice(0, limit) };
  }

  private async toolGetFaqForTopic(args: Record<string, unknown>): Promise<unknown> {
    const topic = args['topic'] as string;
    const limit = (args['limit'] as number) ?? 5;
    if (!topic) throw new Error('Missing topic argument');
    const topicLower = topic.toLowerCase();
    const allQA: Array<{ question: string; answer: string; sourcedFrom: string; score: number }> = [];
    for (const rec of this.opts.pageIndex.list()) {
      const full = rec.full ?? (await this.opts.loadFullPage?.(rec.path));
      if (!full) continue;
      for (const qa of full.qa) {
        const qLower = qa.question.toLowerCase();
        const aLower = qa.answer.toLowerCase();
        let score = 0;
        if (qLower.includes(topicLower)) score += 50;
        if (aLower.includes(topicLower)) score += 20;
        const topicTokens = topicLower.split(/\s+/).filter((t) => t.length > 2);
        for (const tok of topicTokens) {
          if (qLower.includes(tok)) score += 10;
          if (aLower.includes(tok)) score += 4;
        }
        if (score > 0) allQA.push({ question: qa.question, answer: qa.answer, sourcedFrom: rec.url, score });
      }
    }
    allQA.sort((a, b) => b.score - a.score);
    return { topic, count: Math.min(allQA.length, limit), results: allQA.slice(0, limit) };
  }

  private toolListPages(args: Record<string, unknown>): unknown {
    const limit = (args['limit'] as number) ?? 100;
    const offset = (args['offset'] as number) ?? 0;
    const filter = args['filter'] as string | undefined;
    let pages = this.opts.pageIndex.list();
    if (filter) pages = pages.filter((p) => p.path.includes(filter));
    return {
      total: pages.length,
      pages: pages.slice(offset, offset + limit).map((p) => ({
        path: p.path,
        url: p.url,
        title: p.title,
        description: p.description,
        lang: p.lang,
        tokens: p.tokens,
        lastModified: p.lastModified,
      })),
    };
  }

  private async toolGetPage(args: Record<string, unknown>): Promise<unknown> {
    const path = args['path'] as string;
    const format = ((args['format'] as string) ?? 'markdown') as 'markdown' | 'json';
    const rec = this.opts.pageIndex.get(path);
    if (!rec) throw new Error(`Page not found: ${path}`);
    const full = rec.full ?? (await this.opts.loadFullPage?.(path)) ?? null;
    if (!full) throw new Error(`Full content not available for: ${path}`);

    if (format === 'markdown') {
      return {
        url: full.url,
        title: full.title,
        description: full.description,
        markdown: full.markdown,
        tokens: estimateTokens(full.markdown, full.lang ?? 'en'),
      };
    }
    return full;
  }

  private toolSearchPages(args: Record<string, unknown>): unknown {
    const query = args['query'] as string;
    const limit = (args['limit'] as number) ?? 10;
    const results = this.opts.pageIndex.search(query, limit);
    return {
      query,
      count: results.length,
      results: results.map((r) => ({
        path: r.path,
        title: r.title,
        description: r.description,
        tokens: r.tokens,
      })),
    };
  }

  private async toolGetSchema(args: Record<string, unknown>): Promise<unknown> {
    const path = args['path'] as string;
    const rec = this.opts.pageIndex.get(path);
    if (!rec) throw new Error(`Page not found: ${path}`);
    const full = rec.full ?? (await this.opts.loadFullPage?.(path));
    return { path, schema: full?.schemaFound ?? [] };
  }

  private async toolGetFaq(args: Record<string, unknown>): Promise<unknown> {
    const path = args['path'] as string;
    const rec = this.opts.pageIndex.get(path);
    if (!rec) throw new Error(`Page not found: ${path}`);
    const full = rec.full ?? (await this.opts.loadFullPage?.(path));
    return { path, qa: full?.qa ?? [] };
  }

  private toolGetBrand(): unknown {
    return {
      brand: this.opts.config.brand,
      siteUrl: this.opts.config.siteUrl,
    };
  }

  private async readResource(uri: string): Promise<string> {
    if (uri === 'resource://site/sitemap') {
      return JSON.stringify(this.opts.pageIndex.list().map((p) => p.path));
    }
    if (uri === 'resource://site/llms.txt') {
      return 'See /llms.txt endpoint';
    }
    const match = uri.match(/^resource:\/\/site\/page\/(.+)$/);
    if (match) {
      const path = '/' + match[1];
      const rec = this.opts.pageIndex.get(path);
      if (!rec) throw new Error(`Page not found: ${path}`);
      const full = rec.full ?? (await this.opts.loadFullPage?.(path));
      return full?.markdown ?? '';
    }
    throw new Error(`Unknown resource: ${uri}`);
  }

  private ok(id: JsonRpcRequest['id'], result: unknown): JsonRpcResponse {
    return { jsonrpc: '2.0', id, result };
  }

  private err(id: JsonRpcRequest['id'], code: number, message: string): JsonRpcResponse {
    return { jsonrpc: '2.0', id, error: { code, message } };
  }
}

// ============================================================================
// CONTENT NEGOTIATION (next-geo / next-agent-md pattern)
// ============================================================================

/**
 * Request context for negotiation.
 */
export interface NegotiationContext {
  /** Request URL pathname */
  pathname: string;
  /** Accept header */
  accept?: string;
  /** User-Agent header */
  userAgent?: string;
  /** Wszystkie headers (do `?format=md` query param itd.) */
  query?: URLSearchParams;
}

const AI_BOT_UA_PATTERNS = [
  /GPTBot/i,
  /ChatGPT-User/i,
  /OAI-SearchBot/i,
  /ClaudeBot/i,
  /Claude-SearchBot/i,
  /Claude-User/i,
  /PerplexityBot/i,
  /Google-Extended/i,
  /AppleBot-Extended/i,
  /Bytespider/i,
  /CCBot/i,
  /YouBot/i,
  /Meta-ExternalAgent/i,
  // IDE agents (cite Codersera 2026)
  /^axios\//i,
  /\bcurl\/8\./i,
  /^got\//i,
  /\bcolly\//i,
];

export function detectAiBot(userAgent: string | undefined): { isBot: boolean; bot?: string } {
  if (!userAgent) return { isBot: false };
  for (const re of AI_BOT_UA_PATTERNS) {
    if (re.test(userAgent)) return { isBot: true, bot: userAgent.split('/')[0] };
  }
  return { isBot: false };
}

/**
 * Decyzja: czy serwować markdown zamiast HTML?
 *
 * Trzy sygnały (pattern z next-geo):
 *   1. URL kończy się na `.md`
 *   2. `Accept: text/markdown` w request
 *   3. User-Agent zawiera AI bot pattern
 *   4. Query param `?format=md`
 */
export function shouldServeMarkdown(ctx: NegotiationContext): boolean {
  if (ctx.pathname.endsWith('.md')) return true;
  if (ctx.accept?.includes('text/markdown')) return true;
  if (ctx.query?.get('format') === 'md') return true;
  const { isBot } = detectAiBot(ctx.userAgent);
  if (isBot) return true;
  return false;
}

/**
 * Konwertuje HTML do markdown z dodaniem metadata header (token count, schema types).
 */
export interface MarkdownResponse {
  body: string;
  headers: Record<string, string>;
}

export function htmlToMarkdownResponse(html: string, url: string, lang: string = 'pl-PL'): MarkdownResponse {
  const extractor = new ContentExtractor({ url, html });
  const content = extractor.extract();
  const tokens = estimateTokens(content.markdown, lang);

  const header = [
    `# ${content.title}`,
    '',
    content.description ? `> ${content.description}` : '',
    '',
    `<!-- ai-meta: url="${url}" tokens=${tokens} lang="${lang}" -->`,
    '',
  ].filter((l) => l !== undefined).join('\n');

  return {
    body: header + content.markdown,
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'X-AI-Tokens': String(tokens),
      'X-AI-Source-URL': url,
      'X-AI-Lang': lang,
      'Cache-Control': 'public, max-age=300, s-maxage=600',
      Vary: 'Accept, User-Agent',
    },
  };
}
