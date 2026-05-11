/**
 * Multi-tenant types dla agency-scale deployment (100+ klientów).
 *
 * Use case: Wise People — agencja B2B z 100+ klientów. Jeden centralny
 * config opisuje wszystkich klientów, jeden command bakuje wszystkich,
 * jeden dashboard pokazuje agregaty.
 */

import type { SiteToMcpConfig } from '@vidok/site-to-mcp';

export type Industry =
  | 'b2b-saas'
  | 'b2b-services'
  | 'b2c-ecommerce'
  | 'b2c-local'
  | 'blog-publisher'
  | 'corporate'
  | 'nonprofit'
  | 'portfolio'
  | 'directory';

export type DeployMethod = 'rsync' | 'git' | 'sftp' | 'manual';

export interface ClientEntry {
  /** Unique slug (folder name, no spaces) */
  slug: string;
  /** Wyświetlana nazwa klienta */
  name: string;
  /** URL produkcyjnej strony */
  siteUrl: string;
  /** Industry preset — automatycznie dopasuje aiBots, schema priorities, kw seed */
  industry: Industry;
  /** Target keywords per klient (5-20) */
  targetKeywords: string[];
  /** Konkurencja (do tracking) */
  competitors?: string[];
  /** Konfig core nadpisujący industry preset (deep merge) */
  brand: SiteToMcpConfig['brand'];
  /** Per-klient AI bots policy (jeśli różni się od preset) */
  aiBots?: Partial<SiteToMcpConfig['aiBots']>;
  /** Deployment config */
  deploy?: {
    method: DeployMethod;
    target?: string; // np. user@host:/var/www/site/public/seo-bake/
    /** Branch dla git push */
    gitBranch?: string;
    /** Manualny komentarz dla zespołu */
    notes?: string;
  };
  /** Free API credentials per klient (każdy klient ma swoje GSC/PSI) */
  credentials?: {
    psiKey?: string;
    gscCredsPath?: string;
    indexingApiKeyPath?: string;
    indexNowKey?: string;
  };
  /** Max pages do bake (default 100) */
  maxPages?: number;
  /** Czy klient aktywny (false = skip w bulk operations) */
  active?: boolean;
  /** Notes for team */
  notes?: string;
  /** Tag dla filtrowania (np. ["wise-people", "B2B", "EU"]) */
  tags?: string[];
}

export interface ClientsRegistry {
  /** Schema version dla migracji */
  schemaVersion: 'site-to-mcp-clients/2026-05';
  /** Owner agency (Wise People) */
  agency: {
    name: string;
    slug: string;
    contactEmail?: string;
  };
  /** Bazowy folder dla wszystkich bake'ów (default ./wisepeople-portfolio/) */
  portfolioDir: string;
  /** Globalne defaults nadpisywane per klient */
  defaults?: {
    maxPages?: number;
    aiBots?: Partial<SiteToMcpConfig['aiBots']>;
    ollamaUrl?: string;
    /** Slack/email webhook dla alertów */
    notifyWebhook?: string;
    /** Concurrent bake limit (default 3) */
    concurrency?: number;
  };
  /** Lista klientów */
  clients: ClientEntry[];
}

export interface BakeJobStatus {
  clientSlug: string;
  state: 'pending' | 'running' | 'done' | 'failed' | 'skipped';
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  pagesBaked?: number;
  imagesGenerated?: number;
  error?: string;
  bakedAt?: string;
  contentHash?: string;
}

export interface BakeStateFile {
  schemaVersion: 'site-to-mcp-bake-state/2026-05';
  agency: string;
  startedAt: string;
  jobs: Record<string, BakeJobStatus>;
  /** Resumable — gdy proces przerwany */
  resumable: boolean;
}

export interface PortfolioSummary {
  agency: string;
  generatedAt: string;
  totalClients: number;
  activeClients: number;
  baked: number;
  failed: number;
  pending: number;
  totalPages: number;
  totalImages: number;
  totalDurationMs: number;
  avgPagesPerClient: number;
  byIndustry: Record<string, number>;
  failures: Array<{ slug: string; name: string; error: string }>;
  oldestBake: { slug: string; ageDays: number } | null;
  newestBake: { slug: string; bakedAt: string } | null;
}
