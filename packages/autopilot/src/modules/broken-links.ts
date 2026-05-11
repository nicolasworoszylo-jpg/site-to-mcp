/**
 * Module: Broken Link Checker.
 *
 * Parallel HEAD requests dla wszystkich linków zewnętrznych. Zero deps.
 */

import { load } from 'cheerio';
import type { Module, ModuleRunResult, AutopilotConfig, BrokenLinkRecord } from '../types.js';
import type { AutopilotStorage } from '../storage/db.js';

export interface BrokenLinksOpts {
  /** Lista stron do skanowania */
  pages: Array<{ url: string; html: string }>;
  /** Concurrency limit */
  concurrency?: number;
  /** Timeout per link (ms) */
  timeoutMs?: number;
  /** Czy sprawdzać tylko external (default true) */
  externalOnly?: boolean;
}

export class BrokenLinksModule implements Module<BrokenLinksOpts> {
  name = 'broken-links' as const;
  description = 'Parallel HEAD checker dla wszystkich linków na stronach.';

  constructor(private storage: AutopilotStorage, _cfg: AutopilotConfig) {
    void _cfg;
  }

  async run(opts?: BrokenLinksOpts): Promise<ModuleRunResult> {
    const startedAt = new Date().toISOString();
    const start = Date.now();
    const o = opts ?? { pages: [] };
    if (!o.pages?.length) return this.fail(startedAt, start, 'Missing pages');

    const concurrency = o.concurrency ?? 10;
    const timeoutMs = o.timeoutMs ?? 8000;
    const externalOnly = o.externalOnly ?? true;
    const now = new Date().toISOString();

    // Collect all links
    const checks: Array<{ url: string; foundOnPage: string }> = [];
    const seen = new Set<string>();
    for (const page of o.pages) {
      const $ = load(page.html);
      let pageOrigin: string;
      try {
        pageOrigin = new URL(page.url).origin;
      } catch {
        pageOrigin = '';
      }
      $('a[href]').each((_, el) => {
        const href = $(el).attr('href');
        if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return;
        try {
          const u = new URL(href, page.url);
          if (externalOnly && pageOrigin && u.origin === pageOrigin) return;
          const key = `${page.url}→${u.toString()}`;
          if (seen.has(key)) return;
          seen.add(key);
          checks.push({ url: u.toString(), foundOnPage: page.url });
        } catch {
          // skip malformed
        }
      });
    }

    // Parallel HEAD with concurrency cap
    const broken: BrokenLinkRecord[] = [];
    const inFlight: Array<Promise<void>> = [];
    let processed = 0;

    for (const check of checks) {
      const promise = (async () => {
        try {
          const res = await fetch(check.url, {
            method: 'HEAD',
            signal: AbortSignal.timeout(timeoutMs),
            redirect: 'follow',
          });
          if (res.status >= 400) {
            const rec: BrokenLinkRecord = {
              url: check.url,
              status: res.status,
              foundOnPage: check.foundOnPage,
              detectedAt: now,
            };
            broken.push(rec);
            this.storage.insertBrokenLink(rec);
          }
        } catch (err) {
          const rec: BrokenLinkRecord = {
            url: check.url,
            status: 0, // timeout/network error
            foundOnPage: check.foundOnPage,
            detectedAt: now,
          };
          broken.push(rec);
          this.storage.insertBrokenLink(rec);
        }
        processed++;
      })();

      inFlight.push(promise);
      if (inFlight.length >= concurrency) {
        await Promise.race(inFlight);
        // Remove resolved ones (cheap approach)
        for (let i = inFlight.length - 1; i >= 0; i--) {
          if (await Promise.race([inFlight[i], Promise.resolve('pending')]) !== 'pending') {
            inFlight.splice(i, 1);
          }
        }
      }
    }
    await Promise.all(inFlight);

    const finishedAt = new Date().toISOString();
    const result: ModuleRunResult = {
      module: 'broken-links',
      startedAt,
      finishedAt,
      durationMs: Date.now() - start,
      ok: true,
      itemsProcessed: checks.length,
      itemsChanged: broken.length,
      summary: `Checked ${checks.length} links, found ${broken.length} broken`,
      data: { broken: broken.slice(0, 100) },
    };
    this.storage.logRun(result);
    return result;
  }

  private fail(startedAt: string, start: number, error: string): ModuleRunResult {
    const finishedAt = new Date().toISOString();
    const result: ModuleRunResult = {
      module: 'broken-links',
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
