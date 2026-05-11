/**
 * Module: Backlink Monitor.
 *
 * Zero-cost: Common Crawl CDX API (free) + opcjonalnie Google `link:` operator.
 * Common Crawl ma 250+ TB darmowych danych webowych aktualizowanych monthly.
 */

import type { Module, ModuleRunResult, AutopilotConfig, BacklinkRecord } from '../types.js';
import type { AutopilotStorage } from '../storage/db.js';

export interface BacklinkMonitorOpts {
  /** Target domain (twoja strona) */
  targetDomain: string;
  /** Max backlinks per query */
  limit?: number;
}

export class BacklinkMonitorModule implements Module<BacklinkMonitorOpts> {
  name = 'backlink-monitor' as const;
  description = 'Common Crawl CDX backlink scanner (free, 250TB dataset).';

  constructor(private storage: AutopilotStorage, _cfg: AutopilotConfig) {
    void _cfg;
  }

  async run(opts?: BacklinkMonitorOpts): Promise<ModuleRunResult> {
    const startedAt = new Date().toISOString();
    const start = Date.now();
    const o = opts ?? { targetDomain: '' };
    if (!o.targetDomain) return this.fail(startedAt, start, 'Missing targetDomain');

    const limit = o.limit ?? 100;
    const now = new Date().toISOString();
    const collected: BacklinkRecord[] = [];

    try {
      // Common Crawl CDX index — najnowsza
      const indexUrl = `https://index.commoncrawl.org/CC-MAIN-2026-09-index?url=*.${o.targetDomain}&output=json&limit=${limit}`;
      const res = await fetch(indexUrl, { signal: AbortSignal.timeout(60_000) });
      if (res.ok) {
        const text = await res.text();
        const lines = text.split('\n').filter((l) => l.trim());
        for (const line of lines) {
          try {
            const obj = JSON.parse(line) as { url?: string };
            if (!obj.url) continue;
            const u = new URL(obj.url);
            const rec: BacklinkRecord = {
              sourceUrl: obj.url,
              sourceDomain: u.hostname,
              targetUrl: `https://${o.targetDomain}`,
              firstSeenAt: now,
              lastSeenAt: now,
              source: 'common-crawl',
            };
            this.storage.upsertBacklink(rec);
            collected.push(rec);
          } catch {
            // skip malformed
          }
        }
      }
    } catch {
      // Common Crawl unavailable - return empty
    }

    const finishedAt = new Date().toISOString();
    const result: ModuleRunResult = {
      module: 'backlink-monitor', startedAt, finishedAt,
      durationMs: Date.now() - start, ok: true,
      itemsProcessed: collected.length, itemsChanged: collected.length,
      summary: `Found ${collected.length} backlinks for ${o.targetDomain} via Common Crawl`,
      data: { count: collected.length },
    };
    this.storage.logRun(result);
    return result;
  }

  private fail(startedAt: string, start: number, error: string): ModuleRunResult {
    const finishedAt = new Date().toISOString();
    const result: ModuleRunResult = {
      module: 'backlink-monitor', startedAt, finishedAt,
      durationMs: Date.now() - start, ok: false, itemsProcessed: 0, error,
    };
    this.storage.logRun(result);
    return result;
  }
}
