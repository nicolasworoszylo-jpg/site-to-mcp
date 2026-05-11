/**
 * Module: PageSpeed Insights Monitor.
 *
 * Free API: 25 000 req/dzień. Daily snapshot LCP/CLS/INP/TTFB dla każdej
 * monitorowanej strony.
 */

import type { Module, ModuleRunResult, AutopilotConfig, VitalsRecord } from '../types.js';
import type { AutopilotStorage } from '../storage/db.js';

export interface PsiMonitorOpts {
  urls: string[];
  strategy?: 'mobile' | 'desktop';
}

export class PsiMonitorModule implements Module<PsiMonitorOpts> {
  name = 'psi-monitor' as const;
  description = 'Google PageSpeed Insights monitor (free, 25k req/dzień).';
  requires = ['google.pageSpeedKey'];

  constructor(
    private storage: AutopilotStorage,
    private cfg: AutopilotConfig,
  ) {}

  async run(opts?: PsiMonitorOpts): Promise<ModuleRunResult> {
    const startedAt = new Date().toISOString();
    const start = Date.now();
    const o = opts ?? { urls: [] };
    const apiKey = this.cfg.google?.pageSpeedKey;
    if (!apiKey) return this.fail(startedAt, start, 'Missing google.pageSpeedKey in config');
    if (!o.urls?.length) return this.fail(startedAt, start, 'Missing urls');

    const strategy = o.strategy ?? 'mobile';
    const now = new Date().toISOString();
    const records: VitalsRecord[] = [];

    for (const url of o.urls) {
      try {
        const psiUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&strategy=${strategy}&category=performance&key=${apiKey}`;
        const res = await fetch(psiUrl, { signal: AbortSignal.timeout(60_000) });
        if (!res.ok) continue;
        const json = (await res.json()) as {
          loadingExperience?: { metrics?: Record<string, { percentile?: number }> };
        };
        const m = json.loadingExperience?.metrics ?? {};
        const rec: VitalsRecord = {
          url,
          strategy,
          lcp: m['LARGEST_CONTENTFUL_PAINT_MS']?.percentile ?? null,
          cls: m['CUMULATIVE_LAYOUT_SHIFT_SCORE']?.percentile != null
            ? (m['CUMULATIVE_LAYOUT_SHIFT_SCORE']!.percentile! / 100)
            : null,
          inp: m['INTERACTION_TO_NEXT_PAINT']?.percentile ?? null,
          ttfb: m['EXPERIMENTAL_TIME_TO_FIRST_BYTE']?.percentile ?? null,
          capturedAt: now,
        };
        this.storage.insertVitals(rec);
        records.push(rec);
      } catch {
        // skip
      }
    }

    const finishedAt = new Date().toISOString();
    const result: ModuleRunResult = {
      module: 'psi-monitor',
      startedAt,
      finishedAt,
      durationMs: Date.now() - start,
      ok: true,
      itemsProcessed: o.urls.length,
      itemsChanged: records.length,
      summary: `PSI captured for ${records.length}/${o.urls.length} URLs (${strategy})`,
      data: { records },
    };
    this.storage.logRun(result);
    return result;
  }

  private fail(startedAt: string, start: number, error: string): ModuleRunResult {
    const finishedAt = new Date().toISOString();
    const result: ModuleRunResult = {
      module: 'psi-monitor',
      startedAt,
      finishedAt,
      durationMs: Date.now() - start,
      ok: false,
      itemsProcessed: 0,
      error,
    };
    this.storage.logRun(result);
    return result;
  }
}
