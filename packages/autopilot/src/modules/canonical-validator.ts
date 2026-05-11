/**
 * Module: Canonical Chain Validator.
 *
 * Wykrywa canonical loops, chains >1 hop, mismatched canonicals.
 */

import { load } from 'cheerio';
import type { Module, ModuleRunResult, AutopilotConfig } from '../types.js';
import type { AutopilotStorage } from '../storage/db.js';

export interface CanonicalValidatorOpts {
  pages: Array<{ url: string; html: string }>;
}

export class CanonicalValidatorModule implements Module<CanonicalValidatorOpts> {
  name = 'canonical-validator' as const;
  description = 'Canonical chains + loops detector.';

  constructor(private storage: AutopilotStorage, _cfg: AutopilotConfig) {
    void _cfg;
  }

  async run(opts?: CanonicalValidatorOpts): Promise<ModuleRunResult> {
    const startedAt = new Date().toISOString();
    const start = Date.now();
    const o = opts ?? { pages: [] };
    if (!o.pages?.length) return this.fail(startedAt, start, 'Missing pages');

    const map = new Map<string, string>(); // page → canonical
    for (const p of o.pages) {
      const $ = load(p.html);
      const canonical = $('link[rel="canonical"]').attr('href');
      if (canonical) {
        try {
          const abs = new URL(canonical, p.url).toString();
          map.set(p.url, abs);
        } catch {
          // skip malformed
        }
      }
    }

    const issues: Array<{ page: string; type: string; detail: string }> = [];
    for (const [page, canonical] of map) {
      // Self-referencing OK
      if (page === canonical) continue;
      // Chain detection
      const chain: string[] = [page];
      let current = canonical;
      const visited = new Set<string>();
      while (map.has(current) && !visited.has(current)) {
        if (map.get(current) === current) break;
        visited.add(current);
        chain.push(current);
        const next = map.get(current);
        if (!next || next === current) break;
        if (chain.includes(next)) {
          issues.push({ page, type: 'canonical_loop', detail: `Loop: ${chain.join(' → ')} → ${next}` });
          break;
        }
        current = next;
        if (chain.length > 5) {
          issues.push({ page, type: 'canonical_chain', detail: `Chain >5 hops: ${chain.join(' → ')}` });
          break;
        }
      }
    }

    // Brak canonical (warning)
    for (const p of o.pages) {
      if (!map.has(p.url)) {
        issues.push({ page: p.url, type: 'missing_canonical', detail: 'No <link rel="canonical">' });
      }
    }

    const finishedAt = new Date().toISOString();
    const result: ModuleRunResult = {
      module: 'canonical-validator', startedAt, finishedAt,
      durationMs: Date.now() - start, ok: true,
      itemsProcessed: o.pages.length, itemsChanged: issues.length,
      summary: `${issues.length} canonical issues across ${o.pages.length} pages`,
      data: { issues },
    };
    this.storage.logRun(result);
    return result;
  }

  private fail(startedAt: string, start: number, error: string): ModuleRunResult {
    const finishedAt = new Date().toISOString();
    const result: ModuleRunResult = {
      module: 'canonical-validator', startedAt, finishedAt,
      durationMs: Date.now() - start, ok: false, itemsProcessed: 0, error,
    };
    this.storage.logRun(result);
    return result;
  }
}
