/**
 * Next.js adapter.
 *
 * Trzy ścieżki integracji (od najlżejszej):
 *
 * 1. **Middleware (runtime negotiation)** — `middleware.ts` w root:
 *
 *      import { siteToMcpMiddleware } from '@vidok/site-to-mcp/next';
 *      export const middleware = siteToMcpMiddleware({ siteUrl, brand, aiBots });
 *
 *    Co robi: na każdy request sprawdza Accept/UA/URL. Jeśli AI bot lub
 *    `.md` suffix → serwuje markdown z dodatkowymi nagłówkami (X-AI-Tokens).
 *
 * 2. **Route handlers (App Router)** — w `app/.well-known/mcp.json/route.ts`,
 *    `app/llms.txt/route.ts`, `app/robots.txt/route.ts`, `app/sitemap.xml/route.ts`:
 *
 *      import { createMcpRoute, createLlmsTxtRoute, ... } from '@vidok/site-to-mcp/next';
 *      export const GET = createMcpRoute(config);
 *
 * 3. **Build-time static gen** (next.config.js):
 *
 *      const { withSiteToMcp } = require('@vidok/site-to-mcp/next');
 *      module.exports = withSiteToMcp({ siteUrl, brand })(nextConfig);
 *
 *    Co robi: w `next-build` generuje statyczne pliki w `public/` (llms.txt,
 *    robots.txt, agent-card.json itd.).
 */

import type { SiteToMcpConfig } from '../../types/index.js';
import {
  shouldServeMarkdown,
  htmlToMarkdownResponse,
  MCPServer,
  PageIndex,
} from '../../core/mcp-server/index.js';
import { createSiteToMcp, SiteToMcp } from '../../factory.js';

// ============================================================================
// MIDDLEWARE — content negotiation
// ============================================================================

interface NextRequest {
  nextUrl: URL;
  url: string;
  headers: Headers;
}

interface NextResponse {
  new (body: string, init?: { status?: number; headers?: Record<string, string> }): Response;
}

declare const NextResponse: NextResponse | undefined;

export interface MiddlewareConfig extends Partial<SiteToMcpConfig> {
  siteUrl: string;
  brand: SiteToMcpConfig['brand'];
  /** Funkcja ładująca HTML strony — np. fetch albo Next render */
  loadPageHtml?: (path: string) => Promise<string | null>;
}

export function siteToMcpMiddleware(cfg: MiddlewareConfig) {
  const s2m = createSiteToMcp(cfg);
  return async (request: NextRequest): Promise<Response | undefined> => {
    const url = new URL(request.url);
    const ctx = {
      pathname: url.pathname,
      accept: request.headers.get('accept') ?? undefined,
      userAgent: request.headers.get('user-agent') ?? undefined,
      query: url.searchParams,
    };

    // Specjalne ścieżki obsługujemy bezpośrednio
    if (url.pathname === '/llms.txt') {
      return new Response(s2m.generateLlmsTxt(), {
        status: 200,
        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
      });
    }
    if (url.pathname === '/llms-full.txt') {
      const pages = s2m.pageIndex.list().slice(0, 30);
      const content = pages.map((p) => `## ${p.title}\n\n${p.preview.firstParagraph ?? ''}`).join('\n\n---\n\n');
      return new Response(content, {
        status: 200,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }
    if (url.pathname === '/robots.txt') {
      return new Response(s2m.generateRobotsTxt(), {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      });
    }
    if (url.pathname === '/sitemap.xml') {
      return new Response(s2m.generateSitemapXml(), {
        status: 200,
        headers: { 'Content-Type': 'application/xml' },
      });
    }
    if (url.pathname === '/.well-known/agent-card.json') {
      return new Response(s2m.generateAgentCard(), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.pathname === (cfg.mcp?.path ?? '/.well-known/mcp.json')) {
      const mcp = s2m.createMCPServer();
      return new Response(JSON.stringify(mcp.manifest()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.pathname === '/skill.md') {
      return new Response(s2m.generateSkillMd(), {
        status: 200,
        headers: { 'Content-Type': 'text/markdown' },
      });
    }

    // Content negotiation: czy serwować markdown zamiast HTML?
    if (shouldServeMarkdown(ctx) && cfg.loadPageHtml) {
      const cleanPath = url.pathname.replace(/\.md$/, '');
      const html = await cfg.loadPageHtml(cleanPath);
      if (html) {
        const md = htmlToMarkdownResponse(html, request.url, cfg.brand.description?.includes('PL') ? 'pl-PL' : 'en');
        return new Response(md.body, { status: 200, headers: md.headers });
      }
    }

    return undefined; // pass through
  };
}

// ============================================================================
// ROUTE HANDLERS — App Router (Next 13+)
// ============================================================================

export function createMcpRoute(cfg: MiddlewareConfig) {
  const s2m = createSiteToMcp(cfg);
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const mcp = s2m.createMCPServer();

    if (request.method === 'GET') {
      return Response.json(mcp.manifest());
    }

    if (request.method === 'POST') {
      const body = (await request.json()) as { jsonrpc: '2.0'; id: string | number | null; method: string; params?: Record<string, unknown> };
      const result = await mcp.handle(body);
      return Response.json(result);
    }

    return new Response('Method not allowed', { status: 405 });
  };
}

export function createLlmsTxtRoute(cfg: MiddlewareConfig) {
  const s2m = createSiteToMcp(cfg);
  return async (): Promise<Response> =>
    new Response(s2m.generateLlmsTxt(), {
      status: 200,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
    });
}

export function createRobotsRoute(cfg: MiddlewareConfig) {
  const s2m = createSiteToMcp(cfg);
  return async (): Promise<Response> =>
    new Response(s2m.generateRobotsTxt(), {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    });
}

export function createSitemapRoute(cfg: MiddlewareConfig) {
  const s2m = createSiteToMcp(cfg);
  return async (): Promise<Response> =>
    new Response(s2m.generateSitemapXml(), {
      status: 200,
      headers: { 'Content-Type': 'application/xml' },
    });
}

export function createAgentCardRoute(cfg: MiddlewareConfig) {
  const s2m = createSiteToMcp(cfg);
  return async (): Promise<Response> =>
    new Response(s2m.generateAgentCard(), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
}

// ============================================================================
// next.config.js wrapper — build-time generation
// ============================================================================

type NextConfig = Record<string, unknown>;

export function withSiteToMcp(cfg: MiddlewareConfig) {
  return (nextConfig: NextConfig = {}): NextConfig => {
    const s2m = createSiteToMcp(cfg);

    // Hook do `webpack` callback w next.config.js — odpalany przy build
    const orig = nextConfig['webpack'] as ((config: unknown, options: { isServer: boolean; dev: boolean }) => unknown) | undefined;

    nextConfig['webpack'] = (config: unknown, options: { isServer: boolean; dev: boolean }) => {
      if (!options.dev && options.isServer) {
        // Build-time: zapisz statyczne pliki do public/
        try {
          // dynamic import bo te moduły mogą nie być dostępne w runtime browser
          const fs = require('node:fs') as typeof import('node:fs');
          const path = require('node:path') as typeof import('node:path');
          const publicDir = path.join(process.cwd(), 'public');
          if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir, { recursive: true });
          fs.writeFileSync(path.join(publicDir, 'llms.txt'), s2m.generateLlmsTxt());
          fs.writeFileSync(path.join(publicDir, 'robots.txt'), s2m.generateRobotsTxt());
          fs.writeFileSync(path.join(publicDir, 'sitemap.xml'), s2m.generateSitemapXml());
          fs.writeFileSync(path.join(publicDir, 'skill.md'), s2m.generateSkillMd());
          const wellKnownDir = path.join(publicDir, '.well-known');
          if (!fs.existsSync(wellKnownDir)) fs.mkdirSync(wellKnownDir, { recursive: true });
          fs.writeFileSync(path.join(wellKnownDir, 'agent-card.json'), s2m.generateAgentCard());
          // eslint-disable-next-line no-console
          console.log('[site-to-mcp] Generated llms.txt, robots.txt, sitemap.xml, skill.md, .well-known/agent-card.json');
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn('[site-to-mcp] Build-time generation failed:', err);
        }
      }
      return orig ? orig(config, options) : config;
    };

    return nextConfig;
  };
}

export { createSiteToMcp, SiteToMcp, MCPServer, PageIndex };
