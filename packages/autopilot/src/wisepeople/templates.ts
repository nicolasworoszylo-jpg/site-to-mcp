/**
 * Industry templates — presets per typ klienta.
 *
 * Przy `add-client` plugin sugeruje aiBots/schema priorities/keywords pattern
 * wg industry. Można potem nadpisać per klient.
 */

import type { Industry, ClientEntry } from './types.js';
import type { SiteToMcpConfig } from '@vidok/site-to-mcp';

export interface IndustryPreset {
  industry: Industry;
  description: string;
  /** Default AI bots policy dla tego typu */
  aiBots: Partial<SiteToMcpConfig['aiBots']>;
  /** Sugerowane keywords patterns (do uzupełnienia przez klienta) */
  keywordPatterns: string[];
  /** Schema priorities */
  schemaPriority: string[];
  /** Modules do uruchomienia przy bake */
  bakeModules: Array<'alt' | 'rewrite' | 'faq' | 'schema' | 'markdown'>;
  /** Sugerowany max pages */
  maxPages: number;
}

export const INDUSTRY_PRESETS: Record<Industry, IndustryPreset> = {
  'b2b-saas': {
    industry: 'b2b-saas',
    description: 'SaaS dla biznesu — docs, pricing, case studies',
    aiBots: {
      'OAI-SearchBot': true,
      'ChatGPT-User': true,
      PerplexityBot: true,
      'Claude-SearchBot': true,
      'Claude-User': true,
      Bingbot: true,
      AppleBot: true,
      YouBot: true,
      GPTBot: false, // training - większość SaaS nie chce trenować
      ClaudeBot: false,
      'Google-Extended': false,
    },
    keywordPatterns: [
      'co to <produkt>',
      'jak <czynność związana z produktem>',
      'najlepsze <kategoria> dla <branża>',
      '<produkt> vs <konkurent>',
      'cena <produkt>',
      '<produkt> integracja z <narzędzie>',
    ],
    schemaPriority: ['SoftwareApplication', 'Organization', 'Person', 'FAQPage', 'HowTo', 'Article'],
    bakeModules: ['alt', 'rewrite', 'faq', 'schema', 'markdown'],
    maxPages: 200,
  },

  'b2b-services': {
    industry: 'b2b-services',
    description: 'Agencja/konsulting B2B — case studies, services pages, blog',
    aiBots: {
      'OAI-SearchBot': true,
      'ChatGPT-User': true,
      PerplexityBot: true,
      'Claude-SearchBot': true,
      'Claude-User': true,
      Bingbot: true,
      AppleBot: true,
      YouBot: true,
      GPTBot: false,
      ClaudeBot: false,
      'Google-Extended': false,
    },
    keywordPatterns: [
      'najlepsza agencja <usługa>',
      '<usługa> <miasto>',
      'jak wybrać <usługa>',
      'cena <usługa>',
      '<usługa> dla <branża>',
      'czy warto <usługa>',
    ],
    schemaPriority: ['Service', 'Organization', 'Person', 'FAQPage', 'Article', 'Review'],
    bakeModules: ['alt', 'rewrite', 'faq', 'schema', 'markdown'],
    maxPages: 150,
  },

  'b2c-ecommerce': {
    industry: 'b2c-ecommerce',
    description: 'Sklep internetowy — produkty, kategorie, blog poradnikowy',
    aiBots: {
      'OAI-SearchBot': true,
      'ChatGPT-User': true,
      PerplexityBot: true,
      'Claude-SearchBot': true,
      'Claude-User': true,
      Bingbot: true,
      AppleBot: true,
      GPTBot: false,
      'Google-Extended': false,
    },
    keywordPatterns: [
      '<produkt> cena',
      'najlepsze <kategoria>',
      'jak wybrać <produkt>',
      '<produkt> opinie',
      'gdzie kupić <produkt>',
      '<produkt> recenzja',
    ],
    schemaPriority: ['Product', 'AggregateRating', 'Review', 'BreadcrumbList', 'Organization', 'FAQPage'],
    bakeModules: ['alt', 'rewrite', 'faq', 'schema', 'markdown'],
    maxPages: 500,
  },

  'b2c-local': {
    industry: 'b2c-local',
    description: 'Lokalna firma — usługi w mieście, opinie, kontakt',
    aiBots: {
      'OAI-SearchBot': true,
      'ChatGPT-User': true,
      PerplexityBot: true,
      'Claude-SearchBot': true,
      'Claude-User': true,
      Bingbot: true,
      AppleBot: true,
      GPTBot: false,
      'Google-Extended': false,
    },
    keywordPatterns: [
      '<usługa> <miasto>',
      'najlepszy <usługa> w <miasto>',
      '<usługa> blisko mnie',
      'opinie <firma>',
      'kontakt <usługa> <miasto>',
      'godziny otwarcia <firma>',
    ],
    schemaPriority: ['LocalBusiness', 'PostalAddress', 'GeoCoordinates', 'Review', 'AggregateRating', 'FAQPage'],
    bakeModules: ['alt', 'rewrite', 'faq', 'schema', 'markdown'],
    maxPages: 100,
  },

  'blog-publisher': {
    industry: 'blog-publisher',
    description: 'Blog/portal contentowy — artykuły, autorzy, kategorie',
    aiBots: {
      'OAI-SearchBot': true,
      'ChatGPT-User': true,
      PerplexityBot: true,
      'Claude-SearchBot': true,
      'Claude-User': true,
      Bingbot: true,
      AppleBot: true,
      GPTBot: false, // publisherzy nie chcą trenować zwykle
      ClaudeBot: false,
      CCBot: false,
    },
    keywordPatterns: [
      'co to <termin>',
      'jak <czynność>',
      'czy <pytanie>',
      'kiedy <wydarzenie>',
      'najlepsze <kategoria>',
      '<termin> 2026',
    ],
    schemaPriority: ['Article', 'BlogPosting', 'NewsArticle', 'Person', 'Organization', 'FAQPage', 'BreadcrumbList'],
    bakeModules: ['alt', 'rewrite', 'faq', 'schema', 'markdown'],
    maxPages: 500,
  },

  corporate: {
    industry: 'corporate',
    description: 'Strona firmowa — about, careers, press, IR',
    aiBots: {
      'OAI-SearchBot': true,
      'ChatGPT-User': true,
      PerplexityBot: true,
      'Claude-SearchBot': true,
      'Claude-User': true,
      Bingbot: true,
      AppleBot: true,
      GPTBot: false,
      'Google-Extended': false,
    },
    keywordPatterns: [
      '<firma> kto to',
      'praca w <firma>',
      'kontakt <firma>',
      '<firma> opinie',
      'historia <firma>',
      'zarząd <firma>',
    ],
    schemaPriority: ['Organization', 'Person', 'JobPosting', 'PressRelease', 'NewsArticle'],
    bakeModules: ['alt', 'schema', 'markdown'],
    maxPages: 100,
  },

  nonprofit: {
    industry: 'nonprofit',
    description: 'Fundacja/NGO — misja, projekty, donate, raporty',
    aiBots: {
      'OAI-SearchBot': true,
      'ChatGPT-User': true,
      PerplexityBot: true,
      'Claude-SearchBot': true,
      'Claude-User': true,
      Bingbot: true,
      AppleBot: true,
      GPTBot: true, // NGO często chce wpływać na trening
      ClaudeBot: true,
      'Google-Extended': true,
    },
    keywordPatterns: [
      'jak pomóc <cel>',
      'fundacja <obszar>',
      '<problem społeczny> rozwiązanie',
      'donate <cel>',
      'wolontariat <obszar>',
    ],
    schemaPriority: ['NGO', 'Organization', 'Event', 'Person', 'Article', 'DonateAction'],
    bakeModules: ['alt', 'rewrite', 'faq', 'schema', 'markdown'],
    maxPages: 100,
  },

  portfolio: {
    industry: 'portfolio',
    description: 'Strona osobista/portfolio — projekty, about, kontakt',
    aiBots: {
      'OAI-SearchBot': true,
      'ChatGPT-User': true,
      PerplexityBot: true,
      'Claude-SearchBot': true,
      'Claude-User': true,
      Bingbot: true,
      AppleBot: true,
      GPTBot: false,
      ClaudeBot: false,
    },
    keywordPatterns: [
      '<imię nazwisko>',
      '<specjalizacja> portfolio',
      '<imię> projekty',
      'kontakt <imię>',
    ],
    schemaPriority: ['Person', 'CreativeWork', 'Organization'],
    bakeModules: ['alt', 'rewrite', 'schema', 'markdown'],
    maxPages: 50,
  },

  directory: {
    industry: 'directory',
    description: 'Katalog/wyszukiwarka — listy, filtry, profile',
    aiBots: {
      'OAI-SearchBot': true,
      'ChatGPT-User': true,
      PerplexityBot: true,
      'Claude-SearchBot': true,
      'Claude-User': true,
      Bingbot: true,
      AppleBot: true,
      GPTBot: false,
      ClaudeBot: false,
      CCBot: false,
    },
    keywordPatterns: [
      'lista <kategoria>',
      'katalog <kategoria>',
      'najlepsze <kategoria> ranking',
      '<kategoria> porównanie',
    ],
    schemaPriority: ['ItemList', 'Organization', 'BreadcrumbList', 'WebSite'],
    bakeModules: ['schema', 'markdown'],
    maxPages: 300,
  },
};

/**
 * Apply industry preset do ClientEntry (deep merge).
 * Klient może nadpisać każde pole.
 */
export function applyIndustryPreset(entry: ClientEntry): ClientEntry {
  const preset = INDUSTRY_PRESETS[entry.industry];
  if (!preset) return entry;
  return {
    ...entry,
    aiBots: { ...preset.aiBots, ...entry.aiBots },
    maxPages: entry.maxPages ?? preset.maxPages,
  };
}

export function getIndustryPreset(industry: Industry): IndustryPreset {
  return INDUSTRY_PRESETS[industry];
}

export function listIndustries(): Industry[] {
  return Object.keys(INDUSTRY_PRESETS) as Industry[];
}
