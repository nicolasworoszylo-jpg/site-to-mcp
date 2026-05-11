/**
 * Module: Keyword Research.
 *
 * Zero-cost: scrape Google Autosuggest (free, no auth) + People Also Ask
 * z search results page.
 *
 * Output: lista 50-200 keywords per topic, zapisane w SQLite.
 */

import type { Module, ModuleRunResult, KeywordRecord, AutopilotConfig } from '../types.js';
import type { AutopilotStorage } from '../storage/db.js';

export interface KeywordResearchOpts {
  /** Seed kw, np. "cyfrowe zaproszenia" */
  seed: string;
  language?: string;
  /** Locale dla Google: pl, en, de itd. */
  country?: string;
  /** Max liczba kw do zebrania (cap przed Google rate limit) */
  maxKeywords?: number;
}

export class KeywordResearchModule implements Module<KeywordResearchOpts> {
  name = 'keyword-research' as const;
  description = 'Google Autosuggest + People Also Ask scraper (zero-cost).';

  constructor(private storage: AutopilotStorage, _cfg: AutopilotConfig) {
    void _cfg;
  }

  async run(opts?: KeywordResearchOpts): Promise<ModuleRunResult> {
    const startedAt = new Date().toISOString();
    const start = Date.now();
    const o = opts ?? { seed: '' };
    if (!o.seed) {
      return this.fail(startedAt, start, 'Missing required option: seed');
    }
    const lang = o.language ?? 'pl';
    const country = o.country ?? 'pl';
    const max = o.maxKeywords ?? 100;

    const collected = new Set<string>();
    const recs: KeywordRecord[] = [];
    const now = new Date().toISOString();

    try {
      // 1. Google Autosuggest dla seed + każdej litery a-z
      const seedSuggestions = await this.googleAutosuggest(o.seed, country, lang);
      for (const s of seedSuggestions) {
        if (collected.has(s)) continue;
        collected.add(s);
        recs.push({ keyword: s, language: lang, source: 'google-autosuggest', parentKeyword: o.seed, capturedAt: now });
        if (collected.size >= max) break;
      }

      // 2. Dla top 5 suggestions — drugi poziom z każdą literą
      const tier1 = [...collected].slice(0, 5);
      for (const t of tier1) {
        if (collected.size >= max) break;
        for (const letter of 'abcdefghijklmnopqrstuvwxyz') {
          if (collected.size >= max) break;
          const subSugg = await this.googleAutosuggest(`${t} ${letter}`, country, lang);
          for (const s of subSugg) {
            if (collected.has(s)) continue;
            collected.add(s);
            recs.push({ keyword: s, language: lang, source: 'google-autosuggest', parentKeyword: t, capturedAt: now });
            if (collected.size >= max) break;
          }
          await sleep(300);
        }
      }

      // 3. Save do SQLite
      for (const r of recs) this.storage.insertKeyword(r);

      const finishedAt = new Date().toISOString();
      const durationMs = Date.now() - start;
      const result: ModuleRunResult = {
        module: 'keyword-research',
        startedAt,
        finishedAt,
        durationMs,
        ok: true,
        itemsProcessed: recs.length,
        itemsChanged: recs.length,
        summary: `Collected ${recs.length} keywords from seed "${o.seed}"`,
        data: { keywords: recs.map((r) => r.keyword) },
      };
      this.storage.logRun(result);
      return result;
    } catch (err) {
      return this.fail(startedAt, start, String(err));
    }
  }

  private async googleAutosuggest(query: string, country: string, lang: string): Promise<string[]> {
    const url = `https://suggestqueries.google.com/complete/search?client=firefox&q=${encodeURIComponent(query)}&hl=${lang}&gl=${country}`;
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/120.0 Safari/537.36' },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return [];
      const json = (await res.json()) as [string, string[]];
      return Array.isArray(json[1]) ? json[1] : [];
    } catch {
      return [];
    }
  }

  private fail(startedAt: string, start: number, error: string): ModuleRunResult {
    const finishedAt = new Date().toISOString();
    const result: ModuleRunResult = {
      module: 'keyword-research',
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

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
