/**
 * Module: Rank Tracker.
 *
 * Zero-cost: SERP HTML fetch z User-Agent rotation + cheerio parsing.
 * Rate-limit: ~1 query/30s przy default config (Google throttle).
 * Backup engine: Bing, DuckDuckGo (lżejsze throttling).
 */

import { load } from 'cheerio';
import type { Module, ModuleRunResult, RankRecord, AutopilotConfig } from '../types.js';
import type { AutopilotStorage } from '../storage/db.js';

export interface RankTrackerOpts {
  keywords: string[];
  domain: string;
  language?: string;
  country?: string;
  engine?: 'google' | 'bing' | 'duckduckgo';
  delayMs?: number;
}

const USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
];

function pickUa(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)] ?? USER_AGENTS[0]!;
}

export class RankTrackerModule implements Module<RankTrackerOpts> {
  name = 'rank-tracker' as const;
  description = 'SERP scraper z UA rotation (zero-cost, lokalny).';

  constructor(private storage: AutopilotStorage, _cfg: AutopilotConfig) {
    void _cfg;
  }

  async run(opts?: RankTrackerOpts): Promise<ModuleRunResult> {
    const startedAt = new Date().toISOString();
    const start = Date.now();
    const o = opts ?? { keywords: [], domain: '' };
    if (!o.keywords?.length || !o.domain) {
      return this.fail(startedAt, start, 'Missing keywords or domain');
    }
    const engine = o.engine ?? 'google';
    const delay = o.delayMs ?? 30_000;
    const lang = o.language ?? 'pl';
    const country = o.country ?? 'pl';
    const now = new Date().toISOString();

    const found: RankRecord[] = [];

    for (const kw of o.keywords) {
      try {
        const result = await this.searchEngine(engine, kw, lang, country);
        const idx = result.findIndex((r) => r.domain === o.domain || r.domain.endsWith('.' + o.domain) || o.domain.endsWith('.' + r.domain));
        const rec: RankRecord = {
          keyword: kw,
          language: lang,
          domain: o.domain,
          position: idx >= 0 ? idx + 1 : null,
          ...(idx >= 0 && result[idx]?.url ? { url: result[idx]!.url } : {}),
          engine,
          capturedAt: now,
        };
        found.push(rec);
        this.storage.insertRank(rec);
      } catch {
        // soft fail, skip
      }
      if (o.keywords.indexOf(kw) < o.keywords.length - 1) {
        await sleep(delay + Math.floor(Math.random() * 5000));
      }
    }

    const finishedAt = new Date().toISOString();
    const ranked = found.filter((f) => f.position !== null).length;
    const result: ModuleRunResult = {
      module: 'rank-tracker',
      startedAt,
      finishedAt,
      durationMs: Date.now() - start,
      ok: true,
      itemsProcessed: o.keywords.length,
      itemsChanged: ranked,
      summary: `Tracked ${ranked}/${o.keywords.length} keywords on ${engine} for ${o.domain}`,
      data: { records: found },
    };
    this.storage.logRun(result);
    return result;
  }

  private async searchEngine(
    engine: 'google' | 'bing' | 'duckduckgo',
    query: string,
    lang: string,
    country: string,
  ): Promise<Array<{ domain: string; url: string; title: string }>> {
    let url: string;
    if (engine === 'google') {
      url = `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=${lang}&gl=${country}&num=20`;
    } else if (engine === 'bing') {
      url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=${lang}&cc=${country}&count=20`;
    } else {
      url = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=${country}-${lang}`;
    }

    const res = await fetch(url, {
      headers: {
        'User-Agent': pickUa(),
        'Accept-Language': `${lang}-${country},${lang};q=0.9,en;q=0.8`,
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return [];
    const html = await res.text();
    return this.parseResults(engine, html);
  }

  private parseResults(engine: 'google' | 'bing' | 'duckduckgo', html: string): Array<{ domain: string; url: string; title: string }> {
    const $ = load(html);
    const out: Array<{ domain: string; url: string; title: string }> = [];

    if (engine === 'google') {
      $('div.g a:first-of-type, div.MjjYud a:first-of-type, div[data-hveid] a:first-of-type').each((_, el) => {
        const href = $(el).attr('href');
        const title = $(el).find('h3').first().text().trim();
        if (!href || href.startsWith('/search') || !title) return;
        try {
          const u = new URL(href);
          out.push({ domain: u.hostname.replace(/^www\./, ''), url: href, title });
        } catch {
          // skip
        }
      });
    } else if (engine === 'bing') {
      $('li.b_algo h2 a').each((_, el) => {
        const href = $(el).attr('href');
        const title = $(el).text().trim();
        if (!href) return;
        try {
          const u = new URL(href);
          out.push({ domain: u.hostname.replace(/^www\./, ''), url: href, title });
        } catch {
          // skip
        }
      });
    } else {
      $('.result__a').each((_, el) => {
        const href = $(el).attr('href');
        const title = $(el).text().trim();
        if (!href) return;
        try {
          const cleanHref = href.startsWith('/') ? `https://duckduckgo.com${href}` : href;
          const u = new URL(cleanHref);
          const target = u.searchParams.get('uddg') ?? cleanHref;
          const tu = new URL(target.startsWith('http') ? target : `https://${target}`);
          out.push({ domain: tu.hostname.replace(/^www\./, ''), url: tu.toString(), title });
        } catch {
          // skip
        }
      });
    }
    return out.slice(0, 20);
  }

  private fail(startedAt: string, start: number, error: string): ModuleRunResult {
    const finishedAt = new Date().toISOString();
    const result: ModuleRunResult = {
      module: 'rank-tracker',
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
