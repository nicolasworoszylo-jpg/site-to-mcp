/**
 * Module: Lighthouse Audit.
 *
 * Wykorzystuje PageSpeed Insights API jako "remote lighthouse" — pełen
 * audit (performance + accessibility + best-practices + SEO) bez instalacji
 * Puppeteer/Chromium. PSI używa Lighthouse pod spodem.
 *
 * Trade-off: PSI API daje agregaty (kategorii scores). Pełen JSON Lighthouse
 * via local headless Chrome wymaga ~250MB Chromium download — wyłączone w v1.
 * Włączyć przez `local: true` (wymaga osobnej instalacji `puppeteer`).
 */

import type { Module, ModuleRunResult, AutopilotConfig } from '../types.js';
import type { AutopilotStorage } from '../storage/db.js';

export interface LighthouseAuditOpts {
  url: string;
  strategy?: 'mobile' | 'desktop';
  /** Categories — default wszystkie cztery */
  categories?: Array<'performance' | 'accessibility' | 'best-practices' | 'seo'>;
}

export class LighthouseAuditModule implements Module<LighthouseAuditOpts> {
  name = 'lighthouse-audit' as const;
  description = 'PSI-powered Lighthouse audit (performance + a11y + SEO).';
  requires = ['google.pageSpeedKey'];

  constructor(
    private storage: AutopilotStorage,
    private cfg: AutopilotConfig,
  ) {}

  async run(opts?: LighthouseAuditOpts): Promise<ModuleRunResult> {
    const startedAt = new Date().toISOString();
    const start = Date.now();
    const o = opts ?? { url: '' };
    if (!o.url) return this.fail(startedAt, start, 'Missing url');
    const key = this.cfg.google?.pageSpeedKey;
    if (!key) return this.fail(startedAt, start, 'Missing google.pageSpeedKey');

    const strategy = o.strategy ?? 'mobile';
    const categories = o.categories ?? ['performance', 'accessibility', 'best-practices', 'seo'];

    try {
      const catParams = categories.map((c) => `category=${c}`).join('&');
      const url = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(o.url)}&strategy=${strategy}&${catParams}&key=${key}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(90_000) });
      if (!res.ok) return this.fail(startedAt, start, `PSI ${res.status}`);
      const json = (await res.json()) as {
        lighthouseResult?: {
          categories?: Record<string, { score: number; title: string }>;
          audits?: Record<string, { score: number | null; title: string; description?: string }>;
        };
      };
      const cats = json.lighthouseResult?.categories ?? {};
      const audits = json.lighthouseResult?.audits ?? {};
      const scores = Object.fromEntries(
        Object.entries(cats).map(([k, v]) => [k, Math.round(v.score * 100)]),
      );
      const failingAudits = Object.entries(audits)
        .filter(([, v]) => v.score !== null && v.score < 0.9)
        .map(([key, v]) => ({ id: key, title: v.title, score: v.score, description: v.description }))
        .slice(0, 20);

      const finishedAt = new Date().toISOString();
      const result: ModuleRunResult = {
        module: 'lighthouse-audit', startedAt, finishedAt,
        durationMs: Date.now() - start, ok: true,
        itemsProcessed: categories.length, itemsChanged: failingAudits.length,
        summary: `Lighthouse ${strategy}: ${Object.entries(scores).map(([k, v]) => `${k}=${v}`).join(', ')}`,
        data: { scores, failingAudits },
      };
      this.storage.logRun(result);
      return result;
    } catch (err) {
      return this.fail(startedAt, start, String(err));
    }
  }

  private fail(startedAt: string, start: number, error: string): ModuleRunResult {
    const finishedAt = new Date().toISOString();
    const result: ModuleRunResult = {
      module: 'lighthouse-audit', startedAt, finishedAt,
      durationMs: Date.now() - start, ok: false, itemsProcessed: 0, error,
    };
    this.storage.logRun(result);
    return result;
  }
}
