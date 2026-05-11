/**
 * Module: Competitor Tracker.
 *
 * Własny crawler — czyta sitemap konkurencji, dla top 50 stron wyciąga
 * title, word count, schema types. Zero API.
 */

import { load } from 'cheerio';
import type { Module, ModuleRunResult, AutopilotConfig, CompetitorPage } from '../types.js';
import type { AutopilotStorage } from '../storage/db.js';

export interface CompetitorTrackerOpts {
  domains: string[];
  maxPagesPerDomain?: number;
}

export class CompetitorTrackerModule implements Module<CompetitorTrackerOpts> {
  name = 'competitor-tracker' as const;
  description = 'Crawler konkurencji — sitemap + top stron analysis.';

  constructor(private storage: AutopilotStorage, _cfg: AutopilotConfig) {
    void _cfg;
  }

  async run(opts?: CompetitorTrackerOpts): Promise<ModuleRunResult> {
    const startedAt = new Date().toISOString();
    const start = Date.now();
    const o = opts ?? { domains: [] };
    if (!o.domains?.length) return this.fail(startedAt, start, 'Missing domains');

    const maxPages = o.maxPagesPerDomain ?? 50;
    const now = new Date().toISOString();
    const collected: CompetitorPage[] = [];

    for (const domain of o.domains) {
      try {
        const sitemap = await this.fetchSitemap(domain);
        const urls = sitemap.slice(0, maxPages);
        for (const url of urls) {
          try {
            const res = await fetch(url, {
              headers: { 'User-Agent': 'Mozilla/5.0 site-to-mcp-autopilot' },
              signal: AbortSignal.timeout(10_000),
            });
            if (!res.ok) continue;
            const html = await res.text();
            const $ = load(html);
            const title = $('title').first().text().trim() || $('h1').first().text().trim();
            const text = $('main, article, body').first().text().trim();
            const wordCount = text.split(/\s+/).filter((w) => /[\p{L}]/u.test(w)).length;
            const schemaTypes: string[] = [];
            $('script[type="application/ld+json"]').each((_, el) => {
              try {
                const parsed = JSON.parse($(el).html() ?? '');
                const visit = (node: unknown) => {
                  if (!node || typeof node !== 'object') return;
                  if (Array.isArray(node)) { node.forEach(visit); return; }
                  const obj = node as Record<string, unknown>;
                  const t = obj['@type'];
                  if (typeof t === 'string') schemaTypes.push(t);
                  Object.values(obj).forEach(visit);
                };
                visit(parsed);
              } catch {
                // skip
              }
            });
            const rec: CompetitorPage = {
              domain,
              url,
              title,
              wordCount,
              schemaTypes: [...new Set(schemaTypes)],
              capturedAt: now,
            };
            this.storage.insertCompetitorPage(rec);
            collected.push(rec);
          } catch {
            // skip page
          }
          await sleep(500);
        }
      } catch {
        // skip domain
      }
    }

    const finishedAt = new Date().toISOString();
    const result: ModuleRunResult = {
      module: 'competitor-tracker', startedAt, finishedAt,
      durationMs: Date.now() - start, ok: true,
      itemsProcessed: o.domains.length * maxPages, itemsChanged: collected.length,
      summary: `Captured ${collected.length} pages across ${o.domains.length} competitors`,
      data: { pages: collected.slice(0, 50) },
    };
    this.storage.logRun(result);
    return result;
  }

  private async fetchSitemap(domain: string): Promise<string[]> {
    const urls = [`https://${domain}/sitemap.xml`, `https://${domain}/sitemap_index.xml`];
    for (const u of urls) {
      try {
        const res = await fetch(u, { signal: AbortSignal.timeout(10_000) });
        if (!res.ok) continue;
        const xml = await res.text();
        const matches = xml.match(/<loc>([^<]+)<\/loc>/g) ?? [];
        const found = matches.map((m) => m.replace(/<\/?loc>/g, '').trim()).filter((u) => /^https?:\/\//.test(u));
        if (found.length > 0) return found;
      } catch {
        // try next
      }
    }
    return [];
  }

  private fail(startedAt: string, start: number, error: string): ModuleRunResult {
    const finishedAt = new Date().toISOString();
    const result: ModuleRunResult = {
      module: 'competitor-tracker', startedAt, finishedAt,
      durationMs: Date.now() - start, ok: false, itemsProcessed: 0, error,
    };
    this.storage.logRun(result);
    return result;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
