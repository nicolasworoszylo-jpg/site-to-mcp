/**
 * Module: Hreflang Validator.
 *
 * Sprawdza czy każda strona ma reciprocal hreflang + x-default.
 */

import { load } from 'cheerio';
import type { Module, ModuleRunResult, AutopilotConfig } from '../types.js';
import type { AutopilotStorage } from '../storage/db.js';

export interface HreflangValidatorOpts {
  pages: Array<{ url: string; html: string }>;
}

export class HreflangValidatorModule implements Module<HreflangValidatorOpts> {
  name = 'hreflang-validator' as const;
  description = 'Reciprocal hreflang + x-default validator.';

  constructor(private storage: AutopilotStorage, _cfg: AutopilotConfig) {
    void _cfg;
  }

  async run(opts?: HreflangValidatorOpts): Promise<ModuleRunResult> {
    const startedAt = new Date().toISOString();
    const start = Date.now();
    const o = opts ?? { pages: [] };
    if (!o.pages?.length) return this.fail(startedAt, start, 'Missing pages');

    type HreflangMap = Map<string, Map<string, string>>;
    const map: HreflangMap = new Map();
    for (const p of o.pages) {
      const $ = load(p.html);
      const entries = new Map<string, string>();
      $('link[rel="alternate"][hreflang]').each((_, el) => {
        const lang = $(el).attr('hreflang');
        const href = $(el).attr('href');
        if (lang && href) entries.set(lang, href);
      });
      map.set(p.url, entries);
    }

    const issues: Array<{ page: string; type: string; detail: string }> = [];
    for (const [page, entries] of map) {
      if (entries.size === 0) {
        if (o.pages.length > 1) issues.push({ page, type: 'missing_hreflang', detail: 'No hreflang on multi-page site' });
        continue;
      }
      if (!entries.has('x-default')) {
        issues.push({ page, type: 'missing_xdefault', detail: 'No x-default fallback' });
      }
      for (const [lang, href] of entries) {
        if (lang === 'x-default') continue;
        const target = map.get(href);
        if (!target) {
          issues.push({ page, type: 'orphan_hreflang', detail: `${lang} → ${href} not in pages` });
          continue;
        }
        const reciprocal = [...target.values()].includes(page);
        if (!reciprocal) {
          issues.push({ page, type: 'no_reciprocal', detail: `${href} doesn't link back to ${page}` });
        }
      }
    }

    const finishedAt = new Date().toISOString();
    const result: ModuleRunResult = {
      module: 'hreflang-validator',
      startedAt,
      finishedAt,
      durationMs: Date.now() - start,
      ok: true,
      itemsProcessed: o.pages.length,
      itemsChanged: issues.length,
      summary: `${issues.length} hreflang issues across ${o.pages.length} pages`,
      data: { issues },
    };
    this.storage.logRun(result);
    return result;
  }

  private fail(startedAt: string, start: number, error: string): ModuleRunResult {
    const finishedAt = new Date().toISOString();
    const result: ModuleRunResult = {
      module: 'hreflang-validator', startedAt, finishedAt,
      durationMs: Date.now() - start, ok: false, itemsProcessed: 0, error,
    };
    this.storage.logRun(result);
    return result;
  }
}
