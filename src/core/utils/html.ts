/**
 * HTML utilities - cheerio-based parsing, ekstrakcja JSON-LD, metadata.
 *
 * Wszystko co potrzebuje DOM-like parse'a wchodzi tutaj. Cheerio bo:
 * - działa server-side bez JSDOM weight
 * - jQuery-like API znane developerom
 * - obsługuje malformed HTML lepiej niż parse5
 */

import { load } from 'cheerio';

export type Doc = ReturnType<typeof load>;

export function parse(html: string): Doc {
  return load(html);
}

export interface PageMeta {
  title?: string;
  description?: string;
  canonical?: string;
  lang?: string;
  ogType?: string;
  ogImage?: string;
  ogTitle?: string;
  ogDescription?: string;
  twitterCard?: string;
  robots?: string;
  author?: string;
  publishedTime?: string;
  modifiedTime?: string;
  hreflang: Array<{ lang: string; href: string }>;
  /** Surowy meta z całej strony */
  raw: Array<{ name?: string; property?: string; content?: string }>;
}

export function extractMeta($: Doc): PageMeta {
  const meta: PageMeta = {
    title: $('title').first().text().trim() || undefined,
    description: $('meta[name="description"]').attr('content')?.trim(),
    canonical: $('link[rel="canonical"]').attr('href'),
    lang: (($('html').attr('lang')?.trim()) ?? ($('html').attr('xml:lang')?.trim())) ?? undefined,
    ogType: $('meta[property="og:type"]').attr('content'),
    ogImage: $('meta[property="og:image"]').attr('content'),
    ogTitle: $('meta[property="og:title"]').attr('content'),
    ogDescription: $('meta[property="og:description"]').attr('content'),
    twitterCard: $('meta[name="twitter:card"]').attr('content'),
    robots: $('meta[name="robots"]').attr('content'),
    author: ($('meta[name="author"]').attr('content') ?? ($('[itemprop="author"]').first().text().trim() || undefined)),
    publishedTime: $('meta[property="article:published_time"]').attr('content'),
    modifiedTime: $('meta[property="article:modified_time"]').attr('content'),
    hreflang: [],
    raw: [],
  };

  $('link[rel="alternate"][hreflang]').each((_: number, el: unknown) => {
    const $el = $(el as never);
    const lang = $el.attr('hreflang');
    const href = $el.attr('href');
    if (lang && href) meta.hreflang.push({ lang, href });
  });

  $('meta').each((_: number, el: unknown) => {
    const $el = $(el as never);
    meta.raw.push({
      name: $el.attr('name'),
      property: $el.attr('property'),
      content: $el.attr('content'),
    });
  });

  return meta;
}

/**
 * Wyciąga wszystkie bloki JSON-LD ze strony. Toleruje malformed JSON
 * (skip + warning).
 */
export function extractJsonLd($: Doc): Array<{ raw: string; parsed: unknown; error?: string }> {
  const out: Array<{ raw: string; parsed: unknown; error?: string }> = [];
  $('script[type="application/ld+json"]').each((_: number, el: unknown) => {
    const raw = $(el as never).html() ?? '';
    if (!raw.trim()) return;
    try {
      const parsed = JSON.parse(raw);
      out.push({ raw, parsed });
    } catch (err) {
      out.push({ raw, parsed: null, error: String(err) });
    }
  });
  return out;
}

/**
 * Buduje płaską listę typów schema (np. ["Organization", "WebSite", "Article"])
 * z @graph i z zagnieżdżonych @type.
 */
export function listSchemaTypes(blocks: Array<{ parsed: unknown }>): string[] {
  const types = new Set<string>();
  const visit = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    const obj = node as Record<string, unknown>;
    const t = obj['@type'];
    if (typeof t === 'string') types.add(t);
    if (Array.isArray(t)) t.forEach((x) => typeof x === 'string' && types.add(x));
    Object.values(obj).forEach(visit);
  };
  blocks.forEach((b) => visit(b.parsed));
  return [...types];
}

export interface Heading {
  level: 1 | 2 | 3 | 4 | 5 | 6;
  text: string;
  isQuestion: boolean;
  anchor?: string;
  wordsAfter?: number;
}

export function extractHeadings($: Doc): Heading[] {
  const out: Heading[] = [];
  $('h1, h2, h3, h4, h5, h6').each((_: number, el: unknown) => {
    const $el = $(el as never);
    const tag = ((el as { tagName?: string }).tagName ?? 'h2').toLowerCase();
    const level = Number(tag[1]) as Heading['level'];
    const text = $el.text().trim().replace(/\s+/g, ' ');
    if (!text) return;
    const anchor = $el.attr('id');
    out.push({
      level,
      text,
      isQuestion: isQuestionHeading(text),
      ...(anchor ? { anchor } : {}),
    });
  });
  return out;
}

const POLISH_QUESTION_STARTERS = [
  'czy',
  'kto',
  'co',
  'gdzie',
  'kiedy',
  'jak',
  'ile',
  'dlaczego',
  'po co',
  'na co',
  'który',
  'która',
  'które',
  'czyj',
];

const ENGLISH_QUESTION_STARTERS = [
  'what',
  'who',
  'where',
  'when',
  'why',
  'how',
  'which',
  'is',
  'are',
  'do',
  'does',
  'can',
  'should',
  'will',
  'would',
];

/**
 * Heading jest pytaniem jeśli:
 * - kończy się "?"
 * - zaczyna się od pytajnika PL/EN
 *
 * Dlaczego: Indig 30M citations — headings z pytaniami: 78.4% cited content.
 */
export function isQuestionHeading(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return false;
  if (t.endsWith('?')) return true;
  for (const q of POLISH_QUESTION_STARTERS) if (t.startsWith(q + ' ')) return true;
  for (const q of ENGLISH_QUESTION_STARTERS) if (t.startsWith(q + ' ')) return true;
  return false;
}

/**
 * Liczy słowa w tekście (działa dla PL i EN). Usuwa whitespace + dedup.
 */
export function wordCount(text: string): number {
  return text
    .trim()
    .split(/\s+/u)
    .filter((w) => w.length > 0 && /[\p{L}\p{N}]/u.test(w)).length;
}

/**
 * Czysty tekst strony (bez skryptów, styli, nav, footer — to co LLM "widzi"
 * jako "treść właściwą"). Heurystyka: priorytet article > main > body.
 */
export function extractMainText($: Doc): string {
  const $clone = load($.html());
  $clone('script, style, noscript, nav, footer, aside, header').remove();

  let selector = 'article';
  if ($clone(selector).length === 0) selector = 'main';
  if ($clone(selector).length === 0) selector = 'body';

  return $clone(selector)
    .text()
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Pierwsze N słów z main content (do testów "first 30% answered" i Speakable).
 */
export function firstNWords(text: string, n: number): string {
  return text.split(/\s+/u).slice(0, n).join(' ');
}
