/**
 * Module: Outreach Generator.
 *
 * Cel: zwiększyć liczbę LLM citations przez identification "gap" — stron które
 * cytują konkurencję ale nie ciebie. Plus generator email template do outreach.
 *
 * Pipeline:
 *   1. Dla każdego target keyword → scrape top 20 SERP (Google albo Bing)
 *   2. Crawl każdą z tych 20 stron — kogo cytują? (look for outbound links + brand mentions)
 *   3. Cross-reference z competitors list — które strony cytują konkurencję
 *      i mogą cytować Ciebie (z dodatkowym wzmiankowaniem)
 *   4. Score "outreach potential" per strona (domain authority proxy + relevance)
 *   5. Generate email template dla top 10 (Ollama qwen14b)
 */

import { load } from 'cheerio';
import type { Module, ModuleRunResult, AutopilotConfig } from '../types.js';
import type { AutopilotStorage } from '../storage/db.js';
import { OllamaClient } from '../ollama/client.js';

export interface OutreachOpts {
  /** Twoja marka */
  brandName: string;
  brandUrl: string;
  /** Krótki "value prop" dla emailu (1-2 zdania) */
  brandPitch?: string;
  /** Target keywords (do scrape SERP) */
  keywords: string[];
  /** Konkurencja (do detect gap) */
  competitors: string[];
  /** Engine SERP */
  engine?: 'google' | 'bing' | 'duckduckgo';
  /** Max outreach candidates per keyword */
  perKeyword?: number;
  /** Language */
  language?: string;
  /** Country */
  country?: string;
}

export interface OutreachCandidate {
  /** URL strony gdzie outreach */
  url: string;
  /** Domena */
  domain: string;
  /** Tytuł strony */
  title: string;
  /** Pozycja w SERP gdy znaleziona */
  serpPosition?: number;
  /** Pod jakie keyword znaleziono */
  forKeyword: string;
  /** Czy strona cytuje konkurencję */
  mentionsCompetitors: string[];
  /** Czy strona już cytuje Ciebie */
  alreadyMentionsBrand: boolean;
  /** "Outreach potential" 0-100 */
  potential: number;
  /** Reason dla potential (citation-gap, complementary content, etc.) */
  reason: string;
  /** Email outreach template (LLM-generated) */
  emailTemplate?: string;
}

export class OutreachGeneratorModule implements Module<OutreachOpts> {
  name = 'outreach-generator' as const;
  description = 'SERP-based outreach gap analysis + LLM email generator.';
  requires = ['ollama.text'];

  private ollama: OllamaClient;

  constructor(private storage: AutopilotStorage, cfg: AutopilotConfig) {
    this.ollama = new OllamaClient({
      ...(cfg.ollamaUrl ? { baseUrl: cfg.ollamaUrl } : {}),
      ...(cfg.ollamaModels ? { models: cfg.ollamaModels } : {}),
    });
  }

  async run(opts?: OutreachOpts): Promise<ModuleRunResult> {
    const startedAt = new Date().toISOString();
    const start = Date.now();
    const o = opts ?? ({} as OutreachOpts);
    if (!o.brandName || !o.keywords?.length || !o.competitors?.length) {
      return this.fail(startedAt, start, 'Missing brandName/keywords/competitors');
    }
    const lang = o.language ?? 'pl';
    const country = o.country ?? 'pl';
    const engine = o.engine ?? 'google';
    const perKeyword = o.perKeyword ?? 10;

    const candidates: OutreachCandidate[] = [];
    const seenUrls = new Set<string>();

    try {
      for (const kw of o.keywords) {
        const results = await this.searchSerp(engine, kw, lang, country);
        for (let i = 0; i < Math.min(results.length, perKeyword); i++) {
          const res = results[i];
          if (!res || seenUrls.has(res.url)) continue;
          // Skip strony konkurencji + własną
          const isOwn = res.domain === new URL(o.brandUrl).hostname.replace(/^www\./, '');
          const isCompetitor = o.competitors.some((c) => res.domain.endsWith(c.replace(/^www\./, '').replace(/^https?:\/\//, '')));
          if (isOwn || isCompetitor) continue;
          seenUrls.add(res.url);

          const analysis = await this.analyzePage(res.url, o);
          if (analysis) {
            candidates.push({
              ...analysis,
              forKeyword: kw,
              serpPosition: i + 1,
            });
          }
          // gentle rate limit
          await sleep(800);
        }
        // longer wait between keywords (SERP throttle)
        await sleep(30_000);
      }

      // Sortuj po potential, weź top 10
      candidates.sort((a, b) => b.potential - a.potential);
      const top = candidates.slice(0, 10);

      // Generate emails dla top 5
      for (let i = 0; i < Math.min(5, top.length); i++) {
        try {
          top[i]!.emailTemplate = await this.generateEmail(top[i]!, o);
        } catch {
          // skip
        }
      }

      const finishedAt = new Date().toISOString();
      const result: ModuleRunResult = {
        module: 'outreach-generator',
        startedAt,
        finishedAt,
        durationMs: Date.now() - start,
        ok: true,
        itemsProcessed: candidates.length,
        itemsChanged: top.length,
        summary: `Found ${top.length} outreach candidates from ${o.keywords.length} keywords (${candidates.filter((c) => c.mentionsCompetitors.length > 0).length} z citation-gap)`,
        data: { candidates: top },
      };
      this.storage.logRun(result);
      return result;
    } catch (err) {
      return this.fail(startedAt, start, String(err));
    }
  }

  private async searchSerp(
    engine: 'google' | 'bing' | 'duckduckgo',
    query: string,
    lang: string,
    country: string,
  ): Promise<Array<{ url: string; domain: string; title: string }>> {
    let url: string;
    if (engine === 'google') url = `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=${lang}&gl=${country}&num=20`;
    else if (engine === 'bing') url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=${lang}&cc=${country}&count=20`;
    else url = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=${country}-${lang}`;

    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/120.0',
          'Accept-Language': `${lang}-${country}`,
        },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) return [];
      const $ = load(await res.text());
      const out: Array<{ url: string; domain: string; title: string }> = [];

      if (engine === 'google') {
        $('div.g a:first-of-type, div[data-hveid] a:first-of-type').each((_, el) => {
          const href = $(el).attr('href');
          const title = $(el).find('h3').first().text().trim();
          if (!href || href.startsWith('/search') || !title) return;
          try {
            const u = new URL(href);
            out.push({ url: href, domain: u.hostname.replace(/^www\./, ''), title });
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
            out.push({ url: href, domain: u.hostname.replace(/^www\./, ''), title });
          } catch {
            // skip
          }
        });
      }
      return out.slice(0, 20);
    } catch {
      return [];
    }
  }

  private async analyzePage(
    url: string,
    opts: OutreachOpts,
  ): Promise<Omit<OutreachCandidate, 'forKeyword' | 'serpPosition'> | null> {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 outreach-analyzer' },
        signal: AbortSignal.timeout(12_000),
      });
      if (!res.ok) return null;
      const html = await res.text();
      const $ = load(html);

      const title = $('title').first().text().trim() || $('h1').first().text().trim() || url;
      const body = $('main, article, body').first().text();
      const u = new URL(url);
      const domain = u.hostname.replace(/^www\./, '');

      // Czy strona cytuje konkurencję
      const mentionsCompetitors: string[] = [];
      const lowerBody = body.toLowerCase();
      for (const comp of opts.competitors) {
        const cleanComp = comp.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0]?.toLowerCase();
        if (cleanComp && lowerBody.includes(cleanComp)) mentionsCompetitors.push(comp);
      }

      // Outbound links — pomocnicze do scoring
      const outboundDomains: string[] = [];
      $('a[href^="http"]').each((_, el) => {
        const href = $(el).attr('href');
        if (!href) return;
        try {
          const lu = new URL(href);
          if (lu.hostname !== u.hostname) outboundDomains.push(lu.hostname.replace(/^www\./, ''));
        } catch {
          // skip
        }
      });
      for (const comp of opts.competitors) {
        const cleanComp = comp.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0]?.toLowerCase();
        if (cleanComp && outboundDomains.some((d) => d.includes(cleanComp))) {
          if (!mentionsCompetitors.includes(comp)) mentionsCompetitors.push(comp);
        }
      }

      // Czy już cytuje brand
      const brandClean = opts.brandName.toLowerCase();
      const brandDomain = new URL(opts.brandUrl).hostname.replace(/^www\./, '');
      const alreadyMentionsBrand = lowerBody.includes(brandClean) || outboundDomains.includes(brandDomain);

      // Scoring 0-100
      let potential = 0;
      let reason = '';
      if (alreadyMentionsBrand) {
        potential = 30;
        reason = 'Already mentions brand — opportunity for deeper coverage';
      } else if (mentionsCompetitors.length > 0) {
        potential = 75 + mentionsCompetitors.length * 5;
        reason = `Citation gap — mentions ${mentionsCompetitors.length} competitors, NOT you`;
      } else {
        potential = 40;
        reason = 'Relevant SERP result but no current citation gap detected';
      }

      // Bonus za long-form content
      const wordCount = body.split(/\s+/).filter((w) => /[\p{L}]/u.test(w)).length;
      if (wordCount > 800) potential = Math.min(100, potential + 5);

      return {
        url,
        domain,
        title: title.slice(0, 200),
        mentionsCompetitors,
        alreadyMentionsBrand,
        potential,
        reason,
      };
    } catch {
      return null;
    }
  }

  private async generateEmail(candidate: OutreachCandidate, opts: OutreachOpts): Promise<string> {
    const lang = opts.language ?? 'pl';
    const isCitationGap = candidate.mentionsCompetitors.length > 0;
    const prompt = `Write a SHORT outreach email (max 130 words) in ${lang === 'pl' ? 'Polish' : 'English'}.

Context:
- Recipient site: "${candidate.title}" at ${candidate.domain}
- Sender brand: ${opts.brandName} (${opts.brandUrl})
- Sender pitch: ${opts.brandPitch ?? 'expert in our niche'}
${isCitationGap ? `- IMPORTANT: Their article currently mentions ${candidate.mentionsCompetitors.join(', ')} but NOT ${opts.brandName}. Opportunity for brand mention addition.` : ''}

Rules:
- Personalized (mention their article title naturally)
- No fake compliments
- Single value prop why mentioning ${opts.brandName} adds value to their readers
- Soft CTA — "would you consider adding..."
- Sign-off: "Best, [Your name from ${opts.brandName}]"
- Output ONLY the email body, no subject, no preamble.`;

    return (await this.ollama.generate(prompt, { temperature: 0.5, maxTokens: 250 })).trim();
  }

  private fail(startedAt: string, start: number, error: string): ModuleRunResult {
    const finishedAt = new Date().toISOString();
    const result: ModuleRunResult = {
      module: 'outreach-generator',
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
