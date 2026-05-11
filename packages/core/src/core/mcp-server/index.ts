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
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
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
