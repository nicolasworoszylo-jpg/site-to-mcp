/**
 * Monitoring — testowanie cytowań marki w ChatGPT/Perplexity/Claude/Gemini.
 *
 * Pipeline:
 *   1. Lista promptów (config.monitoring.prompts) — pytania które klient
 *      potencjalnie pyta w AI search
 *   2. Wysyłaj każdy prompt do każdego silnika (API calls)
 *   3. Wykryj cytowania: czy `brand.name` lub `siteUrl` jest w odpowiedzi
 *   4. Wykryj konkurencję: kto inny jest cytowany
 *   5. Sentiment: positive/neutral/negative (klasyfikator lokalny lub LLM)
 *   6. Persistencja → SQLite albo plik JSON
 *   7. Raport tygodniowy → markdown
 *
 * Filozofia: nie tworzymy własnego SaaS — wystawiamy 4 adaptery do API
 * publicznych modeli + 1 do Google AI Mode (scraping/PSI-style).
 *
 * Bezpieczeństwo: NIGDY nie loguj API keys. Klucze idą tylko do request
 * headers — nigdzie indziej.
 */

import type {
  PromptTest,
  CitationCheck,
  MonitoringReport,
  SiteToMcpConfig,
} from '../../types/index.js';

export interface MonitoringOptions {
  config: SiteToMcpConfig;
  /** Persisted historical checks (do delta tygodniowego) */
  history?: CitationCheck[];
  log?: (msg: string) => void;
}

export type EngineName = 'chatgpt' | 'perplexity' | 'claude' | 'gemini';

export class Monitor {
  private log: (msg: string) => void;
  constructor(private opts: MonitoringOptions) {
    this.log = opts.log ?? (() => {});
  }

  async run(): Promise<CitationCheck[]> {
    const m = this.opts.config.monitoring;
    if (!m?.enabled) {
      this.log('[monitor] monitoring disabled');
      return [];
    }
    // Parallel z concurrency cap=5 (większość engines ma 5 RPM minimum)
    const tasks: Array<() => Promise<CitationCheck | null>> = [];
    for (const prompt of m.prompts) {
      for (const engine of m.engines) {
        tasks.push(async () => {
          try {
            const check = await this.testPrompt(prompt, engine, m.apiKeys ?? {});
            this.log(`[monitor] ${engine} on "${prompt.prompt.slice(0, 40)}..." → ${check.cited ? 'CITED' : 'not cited'}`);
            return check;
          } catch (err) {
            this.log(`[monitor] ${engine} failed: ${err}`);
            return null;
          }
        });
      }
    }

    const CONCURRENCY = 5;
    const checks: CitationCheck[] = [];
    for (let i = 0; i < tasks.length; i += CONCURRENCY) {
      const batch = tasks.slice(i, i + CONCURRENCY);
      const results = await Promise.all(batch.map((t) => t()));
      for (const r of results) if (r) checks.push(r);
    }
    return checks;
  }

  async testPrompt(prompt: PromptTest, engine: EngineName, keys: NonNullable<NonNullable<SiteToMcpConfig['monitoring']>['apiKeys']>): Promise<CitationCheck> {
    const response = await this.callEngine(engine, prompt, keys);
    return this.analyze(prompt, engine, response);
  }

  private async callEngine(
    engine: EngineName,
    prompt: PromptTest,
    keys: NonNullable<NonNullable<SiteToMcpConfig['monitoring']>['apiKeys']>,
  ): Promise<string> {
    switch (engine) {
      case 'chatgpt':
        return this.callOpenAI(prompt.prompt, keys.openai);
      case 'perplexity':
        return this.callPerplexity(prompt.prompt, keys.perplexity);
      case 'claude':
        return this.callAnthropic(prompt.prompt, keys.anthropic);
      case 'gemini':
        return this.callGemini(prompt.prompt, keys.google);
    }
  }

  private async callOpenAI(prompt: string, apiKey: string | undefined): Promise<string> {
    if (!apiKey) throw new Error('OPENAI_API_KEY required');
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-search-preview',
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!res.ok) throw new Error(`OpenAI ${res.status}`);
    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return json.choices?.[0]?.message?.content ?? '';
  }

  private async callPerplexity(prompt: string, apiKey: string | undefined): Promise<string> {
    if (!apiKey) throw new Error('PERPLEXITY_API_KEY required');
    const res = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'sonar-pro',
        messages: [{ role: 'user', content: prompt }],
        return_citations: true,
      }),
    });
    if (!res.ok) throw new Error(`Perplexity ${res.status}`);
    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }>; citations?: string[] };
    const content = json.choices?.[0]?.message?.content ?? '';
    const citations = (json.citations ?? []).join('\n');
    return `${content}\n\nCITATIONS:\n${citations}`;
  }

  private async callAnthropic(prompt: string, apiKey: string | undefined): Promise<string> {
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY required');
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        // Sonnet 4.5 jest aktualnie publicznie dostępny w Anthropic API.
        // Override przez config.monitoring (przyszła v1.1).
        model: 'claude-sonnet-4-5',
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!res.ok) throw new Error(`Anthropic ${res.status}`);
    const json = (await res.json()) as { content?: Array<{ text?: string }> };
    return (json.content ?? []).map((c) => c.text ?? '').join('\n');
  }

  private async callGemini(prompt: string, apiKey: string | undefined): Promise<string> {
    if (!apiKey) throw new Error('GOOGLE_API_KEY required');
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=${apiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
      }),
    });
    if (!res.ok) throw new Error(`Gemini ${res.status}`);
    const json = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    return (json.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('\n');
  }

  private analyze(prompt: PromptTest, engine: EngineName, response: string): CitationCheck {
    const brand = prompt.brand.toLowerCase();
    const siteUrl = this.opts.config.siteUrl.toLowerCase();
    const siteDomain = new URL(this.opts.config.siteUrl).hostname.toLowerCase();
    const r = response.toLowerCase();

    const cited = r.includes(brand) || r.includes(siteUrl) || r.includes(siteDomain);
    const citationExcerpt = cited ? this.extractExcerpt(response, [brand, siteDomain]) : undefined;

    // Konkurencja
    const otherCitations: string[] = [];
    for (const c of prompt.competitors ?? []) {
      if (r.includes(c.toLowerCase())) otherCitations.push(c);
    }
    // Wyciągnij URL-e z response jako "innych cytowanych"
    const urlRe = /https?:\/\/([\w.-]+)/g;
    let m: RegExpExecArray | null;
    const urls = new Set<string>();
    while ((m = urlRe.exec(response)) !== null) {
      const domain = m[1];
      if (!domain) continue;
      if (domain === siteDomain) continue;
      urls.add(domain);
    }
    for (const u of urls) if (!otherCitations.includes(u)) otherCitations.push(u);

    // Sentiment (uproszczone: keyword-based; produkcja powinna iść do LLM)
    let sentiment: CitationCheck['sentiment'];
    if (cited) {
      const positive = ['best', 'najlepsz', 'recommend', 'polecam', 'great', 'świetn', 'top', 'excellent', 'leader'];
      const negative = ['avoid', 'unikaj', 'bad', 'słab', 'worst', 'najgorsz', 'scam', 'oszust'];
      const posHit = positive.some((p) => r.includes(p));
      const negHit = negative.some((n) => r.includes(n));
      sentiment = negHit && !posHit ? 'negative' : posHit && !negHit ? 'positive' : 'neutral';
    }

    return {
      promptId: prompt.id,
      engine,
      timestamp: new Date().toISOString(),
      cited,
      ...(citationExcerpt ? { citationExcerpt } : {}),
      otherCitations,
      ...(sentiment ? { sentiment } : {}),
      rawResponse: response.slice(0, 4000),
    };
  }

  private extractExcerpt(response: string, keywords: string[]): string {
    const lower = response.toLowerCase();
    for (const kw of keywords) {
      const i = lower.indexOf(kw);
      if (i !== -1) {
        const start = Math.max(0, i - 100);
        const end = Math.min(response.length, i + 200);
        return response.slice(start, end);
      }
    }
    return '';
  }

  /**
   * Generuje raport tygodniowy z historii + current checks.
   */
  generateReport(checks: CitationCheck[], periodStart: string, periodEnd: string): MonitoringReport {
    const brand = this.opts.config.brand.name;
    const byEngine = new Map<string, CitationCheck[]>();
    for (const c of checks) {
      const arr = byEngine.get(c.engine) ?? [];
      arr.push(c);
      byEngine.set(c.engine, arr);
    }

    const citationRate: Record<string, number> = {};
    for (const [engine, arr] of byEngine) {
      citationRate[engine] = arr.filter((c) => c.cited).length / Math.max(arr.length, 1);
    }

    // Share of voice — % checks z brand citation vs total checks (across engines)
    const total = checks.length;
    const ours = checks.filter((c) => c.cited).length;
    const shareOfVoice = total === 0 ? 0 : ours / total;

    // Sentiment
    const sentimentBreakdown: MonitoringReport['sentimentBreakdown'] = {
      positive: 0,
      neutral: 0,
      negative: 0,
    };
    for (const c of checks) {
      if (c.sentiment) sentimentBreakdown[c.sentiment]++;
    }

    // New / lost mentions vs history
    const historical = new Set((this.opts.history ?? []).flatMap((c) => c.otherCitations));
    const current = new Set(checks.flatMap((c) => c.otherCitations));
    const newMentions = [...current].filter((c) => !historical.has(c));
    const lostMentions = [...historical].filter((c) => !current.has(c));

    return {
      periodStart,
      periodEnd,
      brand,
      citationRate,
      shareOfVoice,
      newMentions,
      lostMentions,
      sentimentBreakdown,
      details: checks,
    };
  }

  /**
   * Markdown raport — gotowy do wklejenia w Slack/Notion/Email.
   */
  reportToMarkdown(report: MonitoringReport): string {
    const lines: string[] = [];
    lines.push(`# AI Citations Report — ${report.brand}`);
    lines.push(`**Period:** ${report.periodStart} → ${report.periodEnd}`);
    lines.push('');
    lines.push('## Citation rate per engine');
    lines.push('');
    lines.push('| Engine | Rate |');
    lines.push('|--------|------|');
    for (const [engine, rate] of Object.entries(report.citationRate)) {
      lines.push(`| ${engine} | ${(rate * 100).toFixed(1)}% |`);
    }
    lines.push('');
    lines.push(`**Share of Voice:** ${(report.shareOfVoice * 100).toFixed(1)}%`);
    lines.push('');
    lines.push('## Sentiment');
    lines.push(`- Positive: ${report.sentimentBreakdown.positive}`);
    lines.push(`- Neutral: ${report.sentimentBreakdown.neutral}`);
    lines.push(`- Negative: ${report.sentimentBreakdown.negative}`);
    lines.push('');
    if (report.newMentions.length > 0) {
      lines.push('## 🆕 Nowe wzmianki w odpowiedziach');
      for (const m of report.newMentions) lines.push(`- ${m}`);
      lines.push('');
    }
    if (report.lostMentions.length > 0) {
      lines.push('## 📉 Stracone wzmianki');
      for (const m of report.lostMentions) lines.push(`- ${m}`);
      lines.push('');
    }
    lines.push('## Details (last 20)');
    for (const d of report.details.slice(-20)) {
      lines.push(`- **${d.engine}** | ${d.cited ? '✅ cited' : '❌ not cited'} | ${d.timestamp.slice(0, 10)}`);
      if (d.citationExcerpt) lines.push(`  > ${d.citationExcerpt.slice(0, 200)}...`);
    }
    return lines.join('\n');
  }
}

export async function monitor(opts: MonitoringOptions): Promise<CitationCheck[]> {
  return new Monitor(opts).run();
}
