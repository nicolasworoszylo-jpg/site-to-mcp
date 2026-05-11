/**
 * Shared types dla wszystkich 15 modułów Autopilot.
 *
 * Filozofia: każdy moduł ma input, output, oraz `run()` które wykonuje zadanie.
 * Wszystkie wyniki idą do storage (SQLite) z timestampem — dzięki temu mamy
 * historię dla trend analysis.
 */

import type { SiteToMcp } from '@vidok/site-to-mcp';

// ============================================================================
// AUTOPILOT CONFIG
// ============================================================================

export interface AutopilotConfig {
  /** Reference do site-to-mcp instance (shared core audit/autofix) */
  s2m: SiteToMcp;
  /** Path do SQLite DB (default: ./autopilot.db) */
  storage?: string;
  /** Ollama endpoint (Nicolas: http://localhost:11434) */
  ollamaUrl?: string;
  /** Modele Ollama do użycia */
  ollamaModels?: {
    text?: string; // default: 'qwen2.5:14b'
    vision?: string; // default: 'llama3.2-vision:11b'
    embed?: string; // default: 'nomic-embed-text'
  };
  /** Free APIs (one-time setup) */
  google?: {
    /** Path do service-account JSON (Google Indexing API) */
    indexingApiKeyPath?: string;
    /** OAuth credentials JSON (Search Console API) */
    searchConsoleAuth?: string;
    /** API key dla PageSpeed Insights (free, 25k req/dzień) */
    pageSpeedKey?: string;
  };
  bing?: {
    /** Webmaster Tools API key */
    webmasterKey?: string;
    /** IndexNow key (UUID hostowany jako <key>.txt na stronie) */
    indexNowKey?: string;
  };
  /** Konkurencja do trackingu */
  competitors?: string[];
  /** Target keywords (per language) */
  targetKeywords?: string[];
  /** Schedule per moduł (cron expression albo human-readable) */
  schedule?: Partial<Record<ModuleName, string>>;
  /** Verbose log */
  log?: (msg: string) => void;
}

// ============================================================================
// MODULES
// ============================================================================

export type ModuleName =
  | 'keyword-research'
  | 'rank-tracker'
  | 'alt-generator'
  | 'content-rewriter'
  | 'internal-linking'
  | 'broken-links'
  | 'backlink-monitor'
  | 'competitor-tracker'
  | 'content-refresh'
  | 'gsc-sync'
  | 'psi-monitor'
  | 'indexnow-push'
  | 'hreflang-validator'
  | 'canonical-validator'
  | 'lighthouse-audit'
  | 'outreach-generator';

export interface ModuleRunResult {
  module: ModuleName;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  ok: boolean;
  itemsProcessed: number;
  itemsChanged?: number;
  error?: string;
  /** Module-specific structured output */
  data?: unknown;
  /** Human-readable summary linia */
  summary?: string;
}

export interface Module<TOpts = unknown> {
  name: ModuleName;
  description: string;
  /** Wymagania (np. ['ollama', 'google.searchConsoleAuth']) */
  requires?: string[];
  /** Uruchom moduł — zawsze zwraca result (nigdy throw) */
  run(opts?: TOpts): Promise<ModuleRunResult>;
}

// ============================================================================
// SHARED RECORD TYPES (zapisywane do SQLite)
// ============================================================================

export interface KeywordRecord {
  keyword: string;
  language: string;
  source: 'google-autosuggest' | 'paa' | 'related-searches' | 'manual';
  parentKeyword?: string;
  capturedAt: string;
}

export interface RankRecord {
  keyword: string;
  language: string;
  domain: string;
  position: number | null;
  url?: string;
  engine: 'google' | 'bing' | 'duckduckgo';
  capturedAt: string;
}

export interface BacklinkRecord {
  sourceUrl: string;
  sourceDomain: string;
  targetUrl: string;
  anchorText?: string;
  firstSeenAt: string;
  lastSeenAt: string;
  source: 'common-crawl' | 'google-link' | 'manual';
}

export interface AltTextRecord {
  imageSrc: string;
  altText: string;
  pageUrl: string;
  generatedAt: string;
  model: string;
}

export interface BrokenLinkRecord {
  url: string;
  status: number;
  foundOnPage: string;
  detectedAt: string;
}

export interface VitalsRecord {
  url: string;
  strategy: 'mobile' | 'desktop';
  lcp: number | null;
  cls: number | null;
  inp: number | null;
  ttfb: number | null;
  capturedAt: string;
}

export interface GscRecord {
  page: string;
  query: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  date: string; // YYYY-MM-DD
}

export interface RefreshSuggestion {
  url: string;
  lastModified: string;
  ageDays: number;
  suggestion: string;
  suggestedAt: string;
}

export interface InternalLinkSuggestion {
  fromPage: string;
  toPage: string;
  similarity: number;
  proposedAnchor: string;
  suggestedAt: string;
}

export interface CompetitorPage {
  domain: string;
  url: string;
  title?: string;
  wordCount?: number;
  schemaTypes?: string[];
  capturedAt: string;
}
