/**
 * Schema builder — high-level API.
 *
 * Typical usage:
 *
 *   import { buildSchemaBundle } from '@vidok/site-to-mcp/schema';
 *
 *   const bundle = buildSchemaBundle({
 *     siteUrl: 'https://example.com',
 *     brand: { name: 'Example Inc', sameAs: ['https://linkedin.com/company/...'] },
 *     page: { type: 'Article', url: '...', headline: '...', author: {...}, ... },
 *     faq: [{ question: '...', answer: '...' }, ...],
 *     breadcrumbs: [{ name: 'Home', url: '/' }, ...],
 *   });
 *
 *   // bundle.scriptTag — gotowy <script> do osadzenia w <head>
 *   // bundle.graph — surowy @graph object
 */

import type { SiteToMcpConfig } from '../../types/index.js';
import {
  organization,
  website,
  breadcrumbList,
  article,
  faqPage,
  product,
  localBusiness,
  howTo,
  qaPage,
  speakableSpecification,
  service,
  person,
  graphBundle,
  toScriptTag,
  type ArticleInput,
  type FAQItem,
  type ProductInput,
  type LocalBusinessInput,
  type HowToInput,
  type QAPageInput,
  type ServiceInput,
  type BreadcrumbItem,
} from './templates.js';

export * from './templates.js';

export interface SchemaBundleInput {
  siteUrl: string;
  brand: SiteToMcpConfig['brand'];
  /** Konkretna strona: Article, Product, LocalBusiness, HowTo, Service, QAPage, lub żadna (homepage) */
  page?:
    | ({ type: 'Article' | 'BlogPosting' | 'NewsArticle' } & Omit<ArticleInput, 'publisher'>)
    | ({ type: 'Product' } & ProductInput)
    | ({ type: 'LocalBusiness' } & LocalBusinessInput)
    | ({ type: 'HowTo' } & HowToInput)
    | ({ type: 'Service' } & Omit<ServiceInput, 'provider'>)
    | ({ type: 'QAPage' } & QAPageInput);
  faq?: FAQItem[];
  breadcrumbs?: BreadcrumbItem[];
  /** Czy dodać Speakable site-wide */
  speakable?: boolean;
  speakableSelectors?: string[];
  lang?: string;
}

export interface SchemaBundleOutput {
  graph: Record<string, unknown>;
  scriptTag: string;
  types: string[];
}

export function buildSchemaBundle(input: SchemaBundleInput): SchemaBundleOutput {
  const items: Array<Record<string, unknown>> = [];
  const types: string[] = [];

  // Tier 1: Organization + WebSite
  items.push(organization(input.brand, input.siteUrl));
  types.push('Organization');
  items.push(website(input.siteUrl, input.brand.name, input.lang ?? 'pl-PL'));
  types.push('WebSite');

  // Breadcrumbs
  if (input.breadcrumbs && input.breadcrumbs.length > 0) {
    items.push(breadcrumbList(input.breadcrumbs));
    types.push('BreadcrumbList');
  }

  // Page-type
  if (input.page) {
    const p = input.page;
    if (p.type === 'Article' || p.type === 'BlogPosting' || p.type === 'NewsArticle') {
      items.push(article({ ...p, publisher: input.brand }, p.type));
      types.push(p.type);
    } else if (p.type === 'Product') {
      items.push(product(p));
      types.push('Product');
    } else if (p.type === 'LocalBusiness') {
      items.push(localBusiness(p));
      types.push(p.type ?? 'LocalBusiness');
    } else if (p.type === 'HowTo') {
      items.push(howTo(p));
      types.push('HowTo');
    } else if (p.type === 'Service') {
      items.push(service({ ...p, provider: input.brand }));
      types.push('Service');
    } else if (p.type === 'QAPage') {
      items.push(qaPage(p));
      types.push('QAPage');
    }
  }

  // FAQ — może istnieć obok page-type
  if (input.faq && input.faq.length > 0) {
    items.push(faqPage(input.faq));
    types.push('FAQPage');
  }

  // Speakable
  if (input.speakable) {
    items.push(speakableSpecification(input.speakableSelectors));
    types.push('SpeakableSpecification');
  }

  // Author Person (jeśli brand.primaryAuthor zdefiniowany)
  if (input.brand.primaryAuthor) {
    const p = person(input.brand.primaryAuthor, input.siteUrl);
    p['@context'] = 'https://schema.org';
    items.push(p);
    types.push('Person');
  }

  const graph = graphBundle(items);
  return {
    graph,
    scriptTag: toScriptTag(graph),
    types,
  };
}
