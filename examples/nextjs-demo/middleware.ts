/**
 * Przykład Next.js middleware dla zaproszeniaonline.com.
 * Skopiuj jako middleware.ts do root projektu.
 */

import { siteToMcpMiddleware } from '@vidok/site-to-mcp/next';
import config from './s2m.config.json';

export const middleware = siteToMcpMiddleware({
  ...config,
  loadPageHtml: async (path) => {
    // Dla próbki: fetchujemy oryginalną stronę
    // W produkcji: użyj Next renderToString albo fetch z internal API
    const res = await fetch(`${config.siteUrl}${path}`, {
      headers: { 'User-Agent': 'site-to-mcp internal' },
    });
    return res.ok ? res.text() : null;
  },
});

export const config_matcher = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
