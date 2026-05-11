/**
 * Vanilla adapter — dla stron statycznych (HTML w S3/Vercel static/CDN) +
 * Cloudflare Worker / Vercel Edge Function dla dynamic endpoints.
 *
 * Dwa wzorce użycia:
 *
 * 1. **Browser script tag** (Copy for AI button + light auto-injection):
 *
 *      <script src="https://unpkg.com/@vidok/site-to-mcp/vanilla.js"
 *              data-brand="Example"
 *              data-siteurl="https://example.com"
 *              data-copy-for-ai="true"></script>
 *
 *    Co robi: dodaje "Copy for AI" button na każdej stronie, injectuje
 *    `<meta name="ai:tokens">`, opcjonalnie injectuje schema z data attrs.
 *
 * 2. **Cloudflare Worker / Vercel Edge Function** (serwerowy endpoint):
 *
 *      import { createWorkerHandler } from '@vidok/site-to-mcp/vanilla';
 *      export default { fetch: createWorkerHandler({ siteUrl, brand }) };
 *
 *    Co robi: serwuje /llms.txt, /robots.txt, /sitemap.xml, /.well-known/*,
 *    plus content negotiation dla pozostałych URL (proxy do origin + html→md).
 */

import type { SiteToMcpConfig } from '../../types/index.js';
import { createSiteToMcp } from '../../factory.js';
import { shouldServeMarkdown, htmlToMarkdownResponse, type JsonRpcRequest } from '../../core/mcp-server/index.js';

// ============================================================================
// CLOUDFLARE WORKER / VERCEL EDGE FUNCTION
// ============================================================================

export interface WorkerOptions extends Partial<SiteToMcpConfig> {
  siteUrl: string;
  brand: SiteToMcpConfig['brand'];
  /** Origin URL — gdzie jest prawdziwa strona HTML do proxy */
  origin: string;
}

export function createWorkerHandler(cfg: WorkerOptions) {
  const s2m = createSiteToMcp(cfg);

  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const path = url.pathname;

    // Static AI files
    if (path === '/llms.txt') {
      return new Response(s2m.generateLlmsTxt(), {
        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
      });
    }
    if (path === '/robots.txt') {
      return new Response(s2m.generateRobotsTxt(), {
        headers: { 'Content-Type': 'text/plain' },
      });
    }
    if (path === '/sitemap.xml') {
      return new Response(s2m.generateSitemapXml(), {
        headers: { 'Content-Type': 'application/xml' },
      });
    }
    if (path === '/skill.md') {
      return new Response(s2m.generateSkillMd(), {
        headers: { 'Content-Type': 'text/markdown' },
      });
    }
    if (path === '/.well-known/agent-card.json') {
      return new Response(s2m.generateAgentCard(), {
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (path === (cfg.mcp?.path ?? '/.well-known/mcp.json')) {
      const mcp = s2m.createMCPServer();
      if (request.method === 'GET') return Response.json(mcp.manifest());
      if (request.method === 'POST') {
        const body = (await request.json()) as JsonRpcRequest;
        const result = await mcp.handle(body);
        return Response.json(result);
      }
      return new Response('Method not allowed', { status: 405 });
    }

    // Content negotiation: proxy do origin + markdown jeśli AI bot/Accept/.md
    const cleanPath = path.replace(/\.md$/, '');
    const ctx = {
      pathname: path,
      accept: request.headers.get('accept') ?? undefined,
      userAgent: request.headers.get('user-agent') ?? undefined,
      query: url.searchParams,
    };

    const originUrl = `${cfg.origin.replace(/\/$/, '')}${cleanPath}`;
    const originRes = await fetch(originUrl, {
      headers: { 'User-Agent': request.headers.get('user-agent') ?? 'site-to-mcp-worker' },
    });

    if (shouldServeMarkdown(ctx) && originRes.headers.get('content-type')?.includes('text/html')) {
      const html = await originRes.text();
      const md = htmlToMarkdownResponse(html, request.url, 'pl-PL');
      return new Response(md.body, { status: 200, headers: md.headers });
    }

    // Pass through origin response
    return new Response(originRes.body, {
      status: originRes.status,
      headers: originRes.headers,
    });
  };
}

// ============================================================================
// BROWSER SCRIPT (Copy for AI button + meta injection)
// ============================================================================

export const BROWSER_SCRIPT = `
/*! @vidok/site-to-mcp vanilla browser script v1.0 */
(function() {
  var script = document.currentScript;
  if (!script) return;
  var brand = script.getAttribute('data-brand');
  var siteUrl = script.getAttribute('data-siteurl');
  var copyForAi = script.getAttribute('data-copy-for-ai') !== 'false';

  // Inject ai:tokens meta
  function injectMeta() {
    var text = (document.querySelector('article') || document.querySelector('main') || document.body).innerText;
    var tokens = Math.ceil(text.length / 3.5);
    if (!document.querySelector('meta[name="ai:tokens"]')) {
      var meta = document.createElement('meta');
      meta.name = 'ai:tokens';
      meta.content = String(tokens);
      document.head.appendChild(meta);
    }
  }

  // Copy for AI button
  function injectCopyButton() {
    if (!copyForAi) return;
    if (document.querySelector('[data-s2m-copy]')) return;
    var btn = document.createElement('button');
    btn.setAttribute('data-s2m-copy', '');
    btn.textContent = '📋 Copy for AI';
    btn.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:9999;padding:10px 16px;border-radius:8px;border:none;background:#111;color:#fff;font:14px system-ui;cursor:pointer;box-shadow:0 4px 12px rgba(0,0,0,0.15)';
    btn.addEventListener('click', function() {
      fetch(window.location.pathname + (window.location.pathname.endsWith('/') ? 'index' : '') + '.md')
        .then(function(r) { return r.ok ? r.text() : null; })
        .then(function(md) {
          if (md) {
            navigator.clipboard.writeText(md).then(function() {
              btn.textContent = '✓ Copied';
              setTimeout(function() { btn.textContent = '📋 Copy for AI'; }, 2000);
            });
          } else {
            // fallback: convert inline
            var text = (document.querySelector('article') || document.querySelector('main') || document.body).innerText;
            navigator.clipboard.writeText('# ' + document.title + '\\n\\n' + text);
            btn.textContent = '✓ Copied (HTML)';
            setTimeout(function() { btn.textContent = '📋 Copy for AI'; }, 2000);
          }
        });
    });
    document.body.appendChild(btn);
  }

  if (document.readyState === 'complete') {
    injectMeta(); injectCopyButton();
  } else {
    window.addEventListener('load', function() {
      injectMeta(); injectCopyButton();
    });
  }
})();
`;
