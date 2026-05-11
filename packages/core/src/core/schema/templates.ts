/**
 * Schema.org templates — Tier 1/2/3 system.
 *
 * Tier 1 = obowiązkowy zawsze (Organization, WebSite, BreadcrumbList)
 * Tier 2 = jeśli zasadne (Article/BlogPosting/Product/LocalBusiness/Service/HowTo/FAQPage/Person)
 * Tier 3 = niche (Recipe/Event/Course/JobPosting/Review/AggregateRating/VideoObject/SoftwareApplication/QAPage)
 *
 * Każda funkcja zwraca **kompletny** JSON-LD object gotowy do <script type="application/ld+json">.
 *
 * Filozofia: nie generujemy szkieletów do uzupełnienia — generujemy pełne, walid Schema.org.
 * Brakujące pola pomijamy (nie wstawiamy pustych stringów które Google's Rich Results Test odrzuci).
 */

import type { SiteToMcpConfig } from '../../types/index.js';

type Brand = SiteToMcpConfig['brand'];

const CTX = 'https://schema.org';

// ============================================================================
// TIER 1
// ============================================================================

export function organization(brand: Brand, siteUrl: string): Record<string, unknown> {
  const out: Record<string, unknown> = {
    '@context': CTX,
    '@type': 'Organization',
    name: brand.name,
    url: siteUrl,
  };
  if (brand.legalName) out['legalName'] = brand.legalName;
  if (brand.description) out['description'] = brand.description;
  if (brand.logo) out['logo'] = { '@type': 'ImageObject', url: brand.logo };
  if (brand.sameAs && brand.sameAs.length > 0) out['sameAs'] = brand.sameAs;
  if (brand.contact) {
    const contact: Record<string, unknown> = { '@type': 'ContactPoint', contactType: 'customer service' };
    if (brand.contact.email) contact['email'] = brand.contact.email;
    if (brand.contact.phone) contact['telephone'] = brand.contact.phone;
    out['contactPoint'] = contact;
    if (brand.contact.address) {
      out['address'] = { '@type': 'PostalAddress', streetAddress: brand.contact.address };
    }
  }
  return out;
}

export function website(siteUrl: string, siteName: string, lang = 'pl-PL'): Record<string, unknown> {
  return {
    '@context': CTX,
    '@type': 'WebSite',
    name: siteName,
    url: siteUrl,
    inLanguage: lang,
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: `${siteUrl.replace(/\/$/, '')}/search?q={search_term_string}`,
      },
      'query-input': 'required name=search_term_string',
    },
  };
}

export interface BreadcrumbItem {
  name: string;
  url: string;
}

export function breadcrumbList(items: BreadcrumbItem[]): Record<string, unknown> {
  return {
    '@context': CTX,
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, idx) => ({
      '@type': 'ListItem',
      position: idx + 1,
      name: it.name,
      item: it.url,
    })),
  };
}

// ============================================================================
// TIER 2
// ============================================================================

export interface ArticleInput {
  url: string;
  headline: string;
  description?: string;
  image?: string | string[];
  author: NonNullable<Brand['primaryAuthor']>;
  publisher: Brand;
  datePublished: string; // ISO
  dateModified?: string; // ISO
  inLanguage?: string;
  articleBody?: string;
  keywords?: string[];
  wordCount?: number;
  /** Dodaje Speakable do pierwszych 60 słów (research 2026: +127% voice referrals) */
  speakable?: boolean;
}

export function article(input: ArticleInput, type: 'Article' | 'BlogPosting' | 'NewsArticle' = 'Article'): Record<string, unknown> {
  const out: Record<string, unknown> = {
    '@context': CTX,
    '@type': type,
    headline: input.headline,
    mainEntityOfPage: { '@type': 'WebPage', '@id': input.url },
    datePublished: input.datePublished,
    author: person(input.author, input.url),
    publisher: organization(input.publisher, new URL(input.url).origin),
  };
  if (input.description) out['description'] = input.description;
  if (input.image) out['image'] = input.image;
  if (input.dateModified) out['dateModified'] = input.dateModified;
  if (input.inLanguage) out['inLanguage'] = input.inLanguage;
  if (input.articleBody) out['articleBody'] = input.articleBody;
  if (input.keywords) out['keywords'] = input.keywords.join(', ');
  if (input.wordCount) out['wordCount'] = input.wordCount;
  if (input.speakable) {
    out['speakable'] = {
      '@type': 'SpeakableSpecification',
      cssSelector: ['h1', 'article > p:first-of-type', '[data-speakable]'],
    };
  }
  return out;
}

export function person(p: NonNullable<Brand['primaryAuthor']>, baseUrl?: string): Record<string, unknown> {
  const out: Record<string, unknown> = {
    '@type': 'Person',
    name: p.name,
  };
  if (p.url) out['url'] = p.url.startsWith('http') ? p.url : `${baseUrl?.replace(/\/$/, '')}${p.url}`;
  if (p.jobTitle) out['jobTitle'] = p.jobTitle;
  if (p.image) out['image'] = p.image;
  if (p.sameAs && p.sameAs.length > 0) out['sameAs'] = p.sameAs;
  if (p.credentials && p.credentials.length > 0) {
    out['hasCredential'] = p.credentials.map((c) => ({ '@type': 'EducationalOccupationalCredential', name: c }));
  }
  return out;
}

export interface FAQItem {
  question: string;
  answer: string;
}

export function faqPage(items: FAQItem[]): Record<string, unknown> {
  return {
    '@context': CTX,
    '@type': 'FAQPage',
    mainEntity: items.map((it) => ({
      '@type': 'Question',
      name: it.question,
      acceptedAnswer: { '@type': 'Answer', text: it.answer },
    })),
  };
}

export interface ProductInput {
  name: string;
  description?: string;
  image?: string;
  sku?: string;
  brand?: string;
  price?: number;
  priceCurrency?: string;
  availability?: 'InStock' | 'OutOfStock' | 'PreOrder';
  url: string;
  ratingValue?: number;
  reviewCount?: number;
}

export function product(input: ProductInput): Record<string, unknown> {
  const out: Record<string, unknown> = {
    '@context': CTX,
    '@type': 'Product',
    name: input.name,
    url: input.url,
  };
  if (input.description) out['description'] = input.description;
  if (input.image) out['image'] = input.image;
  if (input.sku) out['sku'] = input.sku;
  if (input.brand) out['brand'] = { '@type': 'Brand', name: input.brand };
  if (typeof input.price === 'number' && input.priceCurrency) {
    out['offers'] = {
      '@type': 'Offer',
      price: input.price,
      priceCurrency: input.priceCurrency,
      availability: `https://schema.org/${input.availability ?? 'InStock'}`,
      url: input.url,
    };
  }
  if (input.ratingValue && input.reviewCount) {
    out['aggregateRating'] = {
      '@type': 'AggregateRating',
      ratingValue: input.ratingValue,
      reviewCount: input.reviewCount,
    };
  }
  return out;
}

export interface LocalBusinessInput {
  name: string;
  url: string;
  telephone?: string;
  address: { street: string; city: string; postalCode: string; country: string };
  geo?: { lat: number; lng: number };
  openingHours?: string[]; // "Mo-Fr 09:00-17:00"
  priceRange?: '$' | '$$' | '$$$' | '$$$$';
  image?: string;
  type?: string; // e.g. 'Restaurant', 'Dentist', 'Store'
}

export function localBusiness(input: LocalBusinessInput): Record<string, unknown> {
  const out: Record<string, unknown> = {
    '@context': CTX,
    '@type': input.type ?? 'LocalBusiness',
    name: input.name,
    url: input.url,
    address: {
      '@type': 'PostalAddress',
      streetAddress: input.address.street,
      addressLocality: input.address.city,
      postalCode: input.address.postalCode,
      addressCountry: input.address.country,
    },
  };
  if (input.telephone) out['telephone'] = input.telephone;
  if (input.geo) {
    out['geo'] = { '@type': 'GeoCoordinates', latitude: input.geo.lat, longitude: input.geo.lng };
  }
  if (input.openingHours) out['openingHoursSpecification'] = input.openingHours;
  if (input.priceRange) out['priceRange'] = input.priceRange;
  if (input.image) out['image'] = input.image;
  return out;
}

export interface HowToInput {
  name: string;
  description?: string;
  totalTime?: string; // ISO 8601 duration
  steps: Array<{ name: string; text: string; image?: string }>;
  supply?: string[];
  tool?: string[];
}

export function howTo(input: HowToInput): Record<string, unknown> {
  const out: Record<string, unknown> = {
    '@context': CTX,
    '@type': 'HowTo',
    name: input.name,
    step: input.steps.map((s, idx) => ({
      '@type': 'HowToStep',
      position: idx + 1,
      name: s.name,
      text: s.text,
      ...(s.image ? { image: s.image } : {}),
    })),
  };
  if (input.description) out['description'] = input.description;
  if (input.totalTime) out['totalTime'] = input.totalTime;
  if (input.supply) out['supply'] = input.supply.map((s) => ({ '@type': 'HowToSupply', name: s }));
  if (input.tool) out['tool'] = input.tool.map((t) => ({ '@type': 'HowToTool', name: t }));
  return out;
}

// ============================================================================
// QAPage — emerging format, 58% więcej ChatGPT citations niż Article (2026 research)
// ============================================================================

export interface QAPageInput {
  url: string;
  question: string;
  acceptedAnswer: { text: string; author?: NonNullable<Brand['primaryAuthor']>; dateCreated?: string };
  suggestedAnswers?: Array<{ text: string; author?: NonNullable<Brand['primaryAuthor']>; upvoteCount?: number }>;
}

export function qaPage(input: QAPageInput): Record<string, unknown> {
  const accepted: Record<string, unknown> = {
    '@type': 'Answer',
    text: input.acceptedAnswer.text,
  };
  if (input.acceptedAnswer.author) accepted['author'] = person(input.acceptedAnswer.author);
  if (input.acceptedAnswer.dateCreated) accepted['dateCreated'] = input.acceptedAnswer.dateCreated;

  const out: Record<string, unknown> = {
    '@context': CTX,
    '@type': 'QAPage',
    mainEntity: {
      '@type': 'Question',
      name: input.question,
      url: input.url,
      acceptedAnswer: accepted,
    },
  };
  if (input.suggestedAnswers && input.suggestedAnswers.length > 0) {
    (out['mainEntity'] as Record<string, unknown>)['suggestedAnswer'] = input.suggestedAnswers.map((a) => {
      const ans: Record<string, unknown> = { '@type': 'Answer', text: a.text };
      if (a.author) ans['author'] = person(a.author);
      if (typeof a.upvoteCount === 'number') ans['upvoteCount'] = a.upvoteCount;
      return ans;
    });
  }
  return out;
}

// ============================================================================
// SPEAKABLE (samodzielnie, np. dla homepage)
// ============================================================================

export function speakableSpecification(selectors: string[] = ['h1', 'article > p:first-of-type', '[data-speakable]']): Record<string, unknown> {
  return {
    '@context': CTX,
    '@type': 'SpeakableSpecification',
    cssSelector: selectors,
  };
}

// ============================================================================
// SERVICE (B2B/B2C — często mylone z Product, ale dla usług to właściwy typ)
// ============================================================================

export interface ServiceInput {
  name: string;
  description: string;
  provider: Brand;
  url: string;
  areaServed?: string | string[];
  offers?: { price: number; priceCurrency: string };
  hasOfferCatalog?: Array<{ name: string; description: string }>;
}

export function service(input: ServiceInput): Record<string, unknown> {
  const out: Record<string, unknown> = {
    '@context': CTX,
    '@type': 'Service',
    name: input.name,
    description: input.description,
    provider: organization(input.provider, new URL(input.url).origin),
    url: input.url,
  };
  if (input.areaServed) out['areaServed'] = input.areaServed;
  if (input.offers) {
    out['offers'] = {
      '@type': 'Offer',
      price: input.offers.price,
      priceCurrency: input.offers.priceCurrency,
    };
  }
  if (input.hasOfferCatalog) {
    out['hasOfferCatalog'] = {
      '@type': 'OfferCatalog',
      name: `Oferty ${input.name}`,
      itemListElement: input.hasOfferCatalog.map((i) => ({
        '@type': 'Offer',
        itemOffered: { '@type': 'Service', name: i.name, description: i.description },
      })),
    };
  }
  return out;
}

// ============================================================================
// @graph (multi-schema bundle - rekomendowany pattern 2026)
// ============================================================================

export function graphBundle(items: Array<Record<string, unknown>>): Record<string, unknown> {
  return {
    '@context': CTX,
    '@graph': items.map((it) => {
      const copy = { ...it };
      delete copy['@context'];
      return copy;
    }),
  };
}

// ============================================================================
// Serialize to <script>
// ============================================================================

export function toScriptTag(schema: Record<string, unknown>, pretty = false): string {
  const json = pretty ? JSON.stringify(schema, null, 2) : JSON.stringify(schema);
  // Escape "</script>" wewnątrz contentu (XSS-safe)
  const safe = json.replace(/<\/(script)/gi, '<\\/$1');
  return `<script type="application/ld+json">\n${safe}\n</script>`;
}
