/**
 * Express adapter.
 *
 * Użycie:
 *
 *     import express from 'express';
 *     import { siteToMcpRouter } from '@vidok/site-to-mcp/express';
 *
 *     const app = express();
 *     app.use(siteToMcpRouter({
 *       siteUrl: 'https://example.com',
 *       brand: { name: 'Example', ... },
 *       aiBots: { GPTBot: true, ... },
 *       loadPageHtml: async (path) => { ... },
 *     }));
 *
 * Co montuje:
 *   GET /llms.txt, /llms-full.txt
 *   GET /robots.txt
 *   GET /sitemap.xml
 *   GET /skill.md, /AGENTS.md
 *   GET /.well-known/agent-card.json
 *   GET /.well-known/mcp.json (manifest)
 *   POST /.well-known/mcp.json (JSON-RPC dispatch)
 *   middleware: content negotiation dla każdego innego requestu
 */

import type { SiteToMcpConfig } from '../../types/index.js';
import { createSiteToMcp } from '../../factory.js';
import { shouldServeMarkdown, htmlToMarkdownResponse, checkAuth, checkRateLimit, type JsonRpcRequest } from '../../core/mcp-server/index.js';

// Minimal Express types - nie chcemy hard dep na @types/express
interface ExpReq {
  url: string;
  path: string;
  method: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
  query: Record<string, string | string[] | undefined>;
  originalUrl: string;
}
interface ExpRes {
  status(code: number): ExpRes;
  set(field: string, val: string): ExpRes;
  type(t: string): ExpRes;
  send(body: string | Buffer): void;
  json(body: unknown): void;
  end(): void;
}
type ExpNext = (err?: unknown) => void;
type Handler = (req: ExpReq, res: ExpRes, next: ExpNext) => void | Promise<void>;

export interface ExpressOptions extends Partial<SiteToMcpConfig> {
  siteUrl: string;
  brand: SiteToMcpConfig['brand'];
  loadPageHtml?: (path: string) => Promise<string | null>;
}

export function siteToMcpRouter(cfg: ExpressOptions): Handler {
  const s2m = createSiteToMcp(cfg);

  return async (req, res, next) => {
    try {
      const path = req.path;

      // Static AI files
      if (path === '/llms.txt') {
        return res.set('Content-Type', 'text/plain; charset=utf-8').set('Cache-Control', 'public, max-age=3600').send(s2m.generateLlmsTxt());
      }
      if (path === '/robots.txt') {
        return res.set('Content-Type', 'text/plain').send(s2m.generateRobotsTxt());
      }
      if (path === '/sitemap.xml') {
        return res.set('Content-Type', 'application/xml').send(s2m.generateSitemapXml());
      }
      if (path === '/skill.md') {
        return res.set('Content-Type', 'text/markdown').send(s2m.generateSkillMd());
      }
      if (path === '/AGENTS.md') {
        return res.set('Content-Type', 'text/markdown').send(s2m.generateAgentsMd());
      }
      if (path === '/.well-known/agent-card.json') {
        return res.type('application/json').send(s2m.generateAgentCard());
      }
      if (path === (cfg.mcp?.path ?? '/.well-known/mcp.json')) {
        // Rate limit + auth check
        const ip = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ?? 'unknown';
        const rl = checkRateLimit(ip, cfg.mcp?.rateLimitPerMin ?? 60);
        res.set('X-RateLimit-Remaining', String(rl.remaining));
        if (!rl.allowed) {
          res.set('Retry-After', String(Math.ceil((rl.resetAt - Date.now()) / 1000)));
          return res.status(429).send('Too Many Requests');
        }
        const authHeader = typeof req.headers['authorization'] === 'string' ? req.headers['authorization'] : undefined;
        const auth = checkAuth(authHeader, cfg.mcp?.requireAuth ?? false, cfg.mcp?.authToken);
        if (!auth.ok) return res.status(401).send(`Unauthorized: ${auth.reason}`);

        const mcp = s2m.createMCPServer();
        if (req.method === 'GET') return res.json(mcp.manifest());
        if (req.method === 'POST') {
          const body = req.body as JsonRpcRequest;
          const result = await mcp.handle(body);
          return res.json(result);
        }
        return res.status(405).send('Method not allowed');
      }

      // Content negotiation
      const ctx = {
        pathname: path,
        accept: typeof req.headers['accept'] === 'string' ? req.headers['accept'] : undefined,
        userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined,
        query: new URLSearchParams(Object.entries(req.query).filter(([_, v]) => typeof v === 'string') as Array<[string, string]>),
      };
      if (shouldServeMarkdown(ctx) && cfg.loadPageHtml) {
        const cleanPath = path.replace(/\.md$/, '');
        const html = await cfg.loadPageHtml(cleanPath);
        if (html) {
          const md = htmlToMarkdownResponse(html, req.originalUrl, 'pl-PL');
          for (const [k, v] of Object.entries(md.headers)) res.set(k, v);
          return res.send(md.body);
        }
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}
