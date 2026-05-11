/**
 * ContentExtractor — wyciąga "co LLM widzi" z HTML.
 *
 * Output to ExtractedContent: czysty markdown + metryki + Q&A + tabelki +
 * statystyki + cytaty + entities. Każdy MCP/llms.txt/AI agent korzysta z tego
 * jednego źródła prawdy.
 *
 * Patterny wzięte z:
 *   - dom-to-semantic-markdown (selectorska heurystyka treści głównej)
 *   - next-geo / next-agent-md (Turndown, ~80% redukcja tokenów)
 *   - Osmani "Agentic Engine Optimization" (token count = first-class metric)
 *
 * Token counting: w przybliżeniu (1 token ≈ 4 znaki dla EN, ~3 dla PL).
 * Nie ładujemy tiktoken — heavy dep. Wystarczy przybliżenie do flagowania
 * stron >30k tokens (krytyczny limit dla agentów wg Osmani'ego).
 */

import TurndownService from 'turndown';
import type { ExtractedContent, SchemaContext } from '../../types/index.js';
import {
  parse,
  extractMeta,
  extractHeadings,
  extractMainText,
  extractJsonLd,
  isQuestionHeading,
  wordCount,
  firstNWords,
} from '../utils/index.js';

export interface ExtractOptions {
  url: string;
  html: string;
  /** Czy używać tokenizera tiktoken (slow) zamiast estymacji (default false) */
  preciseTokens?: boolean;
}

const turndown = new TurndownService({
  headingStyle: 'atx',
  hr: '---',
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
  emDelimiter: '_',
  linkStyle: 'inlined',
  linkReferenceStyle: 'full',
});

// Dodatkowe reguły: tabele zachowujemy w GFM
turndown.addRule('strikethrough', {
  filter: ['del', 's'],
  replacement: (content: string) => `~~${content}~~`,
});

turndown.addRule('removeNavFooter', {
  filter: ((node: { nodeName?: string }) =>
    !!node.nodeName && ['NAV', 'FOOTER', 'ASIDE', 'SCRIPT', 'STYLE'].includes(node.nodeName.toUpperCase())) as never,
  replacement: () => '',
});

export class ContentExtractor {
  constructor(private opts: ExtractOptions) {}

  extract(): ExtractedContent {
    const $ = parse(this.opts.html);
    const meta = extractMeta($);
    const headings = extractHeadings($);

    // 1. Markdown
    const mainHtml = this.getMainHtml($);
    const markdown = turndown.turndown(mainHtml).trim();

    // 2. Q&A pairs
    const qa = this.extractQAPairs($);

    // 3. Stats
    const stats = this.extractStats(markdown);

    // 4. Quotes
    const quotes = this.extractQuotes($);

    // 5. Tables
    const tables = this.extractTables($);

    // 6. Entities (proper nouns - lekki heurystyk)
    const entities = this.extractEntities(markdown);

    // 7. Outbound links
    const outboundLinks = this.extractOutboundLinks($);

    // 8. Schema znalezione
    const jsonLd = extractJsonLd($);
    const schemaFound: SchemaContext[] = jsonLd
      .filter((b) => b.parsed && !b.error)
      .map((b) => ({
        type: this.getSchemaType(b.parsed),
        data: b.parsed as Record<string, unknown>,
        scope: 'page' as const,
        tier: 1 as const,
      }));

    // 9. Metrics
    const mainText = extractMainText($);
    const wc = wordCount(mainText);
    const first30Pct = firstNWords(mainText, Math.max(60, Math.floor(wc * 0.3)));
    const first30PctAnswered = /\d|to\s+jest|polega|odpowied|znajdziesz|here\s+is|the\s+answer|means|consists/i.test(first30Pct);

    const tokens = mainText.split(/\s+/u).filter((t) => /[\p{L}]/u.test(t));
    const properNouns = tokens.filter((t) => /^[A-ZŁŚŻŹĆĄĘÓŃ][\p{L}-]+$/u.test(t)).length;
    const entityDensityPct = tokens.length === 0 ? 0 : (properNouns / tokens.length) * 100;

    const h3 = headings.filter((h) => h.level === 3);
    const h3Q = h3.filter((h) => h.isQuestion);
    const h3QuestionsPct = h3.length === 0 ? 0 : Math.round((h3Q.length / h3.length) * 100);

    const chunks = this.chunkText(markdown);
    const avgChunkWords = chunks.length === 0 ? 0 : Math.round(chunks.reduce((a, c) => a + wordCount(c), 0) / chunks.length);

    return {
      url: this.opts.url,
      title: meta.title ?? '',
      description: meta.description,
      lang: meta.lang,
      markdown,
      headings: headings.map((h) => ({ ...h })),
      qa,
      stats,
      quotes,
      tables,
      entities,
      metrics: {
        wordCount: wc,
        entityDensityPct,
        statsCount: stats.length,
        questionMarksCount: (mainText.match(/\?/g) ?? []).length,
        h3QuestionsPct,
        first30PctAnswered,
        avgChunkWords,
      },
      schemaFound,
      outboundLinks,
    };
  }

  private getMainHtml($: ReturnType<typeof parse>): string {
    if ($('article').length > 0) return $('article').first().html() ?? '';
    if ($('main').length > 0) return $('main').first().html() ?? '';
    return $('body').first().html() ?? '';
  }

  private extractQAPairs($: ReturnType<typeof parse>): ExtractedContent['qa'] {
    const out: ExtractedContent['qa'] = [];

    // 1. Z FAQPage schema
    const jsonLd = extractJsonLd($);
    for (const block of jsonLd) {
      const parsed = block.parsed as { mainEntity?: Array<{ name?: string; acceptedAnswer?: { text?: string } }> };
      if (parsed?.mainEntity) {
        for (const q of parsed.mainEntity) {
          if (q.name && q.acceptedAnswer?.text) {
            out.push({
              question: q.name,
              answer: q.acceptedAnswer.text,
              wordCount: wordCount(q.acceptedAnswer.text),
            });
          }
        }
      }
    }

    // 2. Z H3/H4 pattern (pytanie → następny <p>)
    if (out.length === 0) {
      $('h2, h3, h4').each((_: number, el: unknown) => {
        const $el = $(el as never);
        const text = $el.text().trim();
        if (!isQuestionHeading(text)) return;
        const next = $el.next('p, div').first();
        const answer = next.text().trim();
        if (answer && answer.length > 10) {
          out.push({
            question: text,
            answer,
            wordCount: wordCount(answer),
          });
        }
      });
    }

    return out;
  }

  private extractStats(markdown: string): ExtractedContent['stats'] {
    const out: ExtractedContent['stats'] = [];
    const re = /(\d+(?:[.,]\d+)?\s*(?:%|procent|tys|tysięcy|mln|million|billion|mld|bln|x|times|razy)?)/gi;
    const sentences = markdown.split(/(?<=[.!?])\s+/);
    for (const s of sentences) {
      const matches = s.match(re);
      if (!matches) continue;
      for (const m of matches) {
        // pomijaj wartości w nawiasach url i daty (4 cyfry to często rok)
        if (/^(19|20)\d{2}$/.test(m.trim())) continue;
        out.push({
          value: m.trim(),
          context: s.trim().slice(0, 200),
        });
      }
    }
    return out;
  }

  private extractQuotes($: ReturnType<typeof parse>): ExtractedContent['quotes'] {
    const out: ExtractedContent['quotes'] = [];
    $('blockquote').each((_: number, el: unknown) => {
      const $el = $(el as never);
      const text = $el.clone().find('cite, footer').remove().end().text().trim();
      const attribution = $el.find('cite, footer').first().text().trim() || undefined;
      if (text) out.push({ text, ...(attribution ? { attribution } : {}) });
    });
    // Pattern: "tekst" — autor
    const html = $.html();
    const re = /[„"]([^"„"]{20,400})[""]\s*[—–-]\s*([\p{L}\s.]{3,80})/gu;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
      const text = m[1]?.trim() ?? '';
      const attribution = m[2]?.trim();
      if (text) out.push({ text, ...(attribution ? { attribution } : {}) });
    }
    return out;
  }

  private extractTables($: ReturnType<typeof parse>): ExtractedContent['tables'] {
    const out: ExtractedContent['tables'] = [];
    $('table').each((_: number, table: unknown) => {
      const $table = $(table as never);
      const caption = $table.find('caption').first().text().trim() || undefined;
      const headers: string[] = [];
      $table.find('thead th, tr:first-child th').each((_: number, th: unknown) => {
        headers.push($(th as never).text().trim());
      });
      const rows: string[][] = [];
      $table.find('tbody tr, tr').each((idx: number, tr: unknown) => {
        if (idx === 0 && headers.length > 0) return;
        const row: string[] = [];
        $(tr as never).find('td').each((_: number, td: unknown) => {
          row.push($(td as never).text().trim());
        });
        if (row.length > 0) rows.push(row);
      });
      if (rows.length > 0) out.push({ ...(caption ? { caption } : {}), headers, rows });
    });
    return out;
  }

  private extractEntities(markdown: string): ExtractedContent['entities'] {
    // DoS guard: cap input + cap iteracji. Bez tego regex z `{0,3}` może mieć
    // catastrophic backtracking dla pathological input (10MB markdown).
    const MAX_CHARS = 500_000;
    const MAX_ITERATIONS = 50_000;
    const truncated = markdown.length > MAX_CHARS ? markdown.slice(0, MAX_CHARS) : markdown;

    const counts = new Map<string, number>();
    const re = /\b([A-ZŁŚŻŹĆĄĘÓŃ][\p{L}]+(?:\s+[A-ZŁŚŻŹĆĄĘÓŃ][\p{L}]+){0,3})\b/gu;
    let m: RegExpExecArray | null;
    let iters = 0;
    while ((m = re.exec(truncated)) !== null && iters < MAX_ITERATIONS) {
      iters++;
      const word = m[1];
      if (!word) continue;
      if (word.length < 3) continue;
      const pos = m.index ?? 0;
      const before = truncated.slice(Math.max(0, pos - 2), pos);
      if (/[.!?]\s$/.test(before) || pos === 0) continue;
      counts.set(word, (counts.get(word) ?? 0) + 1);
    }
    return [...counts.entries()]
      .filter(([, count]) => count >= 2)
      .map(([name, occurrences]) => ({ name, occurrences }))
      .sort((a, b) => b.occurrences - a.occurrences)
      .slice(0, 30);
  }

  private extractOutboundLinks($: ReturnType<typeof parse>): ExtractedContent['outboundLinks'] {
    const out: ExtractedContent['outboundLinks'] = [];
    const ownDomain = new URL(this.opts.url).hostname;
    const authoritative = [
      'wikipedia.org', 'wikidata.org', '.gov', '.edu', '.gov.pl',
      'gov.uk', 'europa.eu', 'who.int', 'oecd.org', 'imf.org',
      'arxiv.org', 'nature.com', 'science.org', 'github.com',
    ];
    $('a[href^="http"]').each((_: number, el: unknown) => {
      const $el = $(el as never);
      const href = $el.attr('href');
      const text = $el.text().trim();
      if (!href) return;
      try {
        const u = new URL(href);
        if (u.hostname === ownDomain) return;
        out.push({
          href,
          text,
          domain: u.hostname,
          isAuthoritative: authoritative.some((d) => u.hostname.endsWith(d)),
        });
      } catch {
        // skip malformed
      }
    });
    // dedup by href
    const seen = new Set<string>();
    return out.filter((l) => (seen.has(l.href) ? false : (seen.add(l.href), true)));
  }

  private getSchemaType(parsed: unknown): SchemaContext['type'] {
    if (typeof parsed !== 'object' || !parsed) return 'CreativeWork';
    const t = (parsed as { '@type'?: unknown })['@type'];
    if (typeof t === 'string') return t as SchemaContext['type'];
    if (Array.isArray(t) && typeof t[0] === 'string') return t[0] as SchemaContext['type'];
    return 'CreativeWork';
  }

  /**
   * Chunkuje markdown na ~150-słowne segmenty (research: 50-150 chunks = 2.3x
   * więcej cytowań). Spilt po nagłówkach > paragrafach.
   */
  chunkText(markdown: string, targetWords = 150): string[] {
    const out: string[] = [];
    const blocks = markdown.split(/\n\s*\n/);
    let buffer: string[] = [];
    let bufferWords = 0;
    for (const block of blocks) {
      const w = wordCount(block);
      if (bufferWords + w > targetWords && buffer.length > 0) {
        out.push(buffer.join('\n\n'));
        buffer = [];
        bufferWords = 0;
      }
      buffer.push(block);
      bufferWords += w;
    }
    if (buffer.length > 0) out.push(buffer.join('\n\n'));
    return out;
  }
}

/**
 * Estymacja tokenów: ~4 znaki/token dla EN, ~3 dla PL.
 *
 * Osmani 2026: pages >30k tokens powodują że agenci "truncate silently, skip
 * entirely, or hallucinate solutions". To jest twardy limit do flagowania.
 */
export function estimateTokens(text: string, lang: string = 'en'): number {
  const charsPerToken = lang.startsWith('pl') ? 3 : 4;
  return Math.ceil(text.length / charsPerToken);
}

export function extractContent(opts: ExtractOptions): ExtractedContent {
  return new ContentExtractor(opts).extract();
}
