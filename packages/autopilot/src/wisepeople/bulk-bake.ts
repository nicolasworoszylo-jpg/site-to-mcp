/**
 * Bulk bake orchestrator — 100+ klientów, jeden command.
 *
 * Features:
 *   - Concurrent baking z configurable limit (Ollama RAM)
 *   - Resumable state — przerwany proces wraca tam gdzie skończył
 *   - Per-client failure isolation — jeden klient padł, reszta jedzie
 *   - Status tracking w SQLite + JSON state file
 *   - Optional Slack/email notification
 *   - Progress reporting (live)
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createSiteToMcp } from '@vidok/site-to-mcp';
import { BakeOrchestrator } from '../bake/orchestrator.js';
import type { AutopilotConfig } from '../types.js';
import type { Registry } from './registry.js';
import type { ClientEntry, BakeStateFile, BakeJobStatus } from './types.js';

export interface BulkBakeOptions {
  /** Slug konkretnych klientów (default: wszyscy active) */
  clientSlugs?: string[];
  /** Industry filter */
  industry?: string;
  /** Tag filter */
  tag?: string;
  /** Refresh mode — skip jeśli nie zmienione */
  refresh?: boolean;
  /** Max concurrent bake (default 3 — Ollama RAM) */
  concurrency?: number;
  /** State file path (resumable) */
  stateFile?: string;
  /** Continue from previous run (skip done jobs) */
  resume?: boolean;
  /** Verbose log */
  log?: (msg: string) => void;
  /** Notification webhook (Slack/Discord/custom) */
  notifyWebhook?: string;
}

export interface BulkBakeResult {
  agency: string;
  startedAt: string;
  finishedAt: string;
  totalClients: number;
  succeeded: number;
  failed: number;
  skipped: number;
  totalPagesBaked: number;
  totalImagesGenerated: number;
  totalDurationMs: number;
  jobs: BakeJobStatus[];
  stateFile: string;
}

export class BulkBakeOrchestrator {
  private log: (msg: string) => void;

  constructor(
    private registry: Registry,
    private autopilotConfig: AutopilotConfig,
  ) {
    this.log = autopilotConfig.log ?? ((m) => console.log(`[bulk-bake] ${m}`));
  }

  async bake(opts: BulkBakeOptions = {}): Promise<BulkBakeResult> {
    const registry = this.registry.load();
    const startedAt = new Date().toISOString();
    const stateFile = opts.stateFile ?? resolve(registry.portfolioDir, '.bake-state.json');
    const concurrency = opts.concurrency ?? registry.defaults?.concurrency ?? 3;

    // Wybierz klientów
    let clients = this.registry.listClients({ active: true });
    if (opts.clientSlugs) clients = clients.filter((c) => opts.clientSlugs!.includes(c.slug));
    if (opts.industry) clients = clients.filter((c) => c.industry === opts.industry);
    if (opts.tag) clients = clients.filter((c) => (c.tags ?? []).includes(opts.tag!));

    if (clients.length === 0) {
      this.log('No matching clients');
      return this.emptyResult(registry.agency.name, startedAt, stateFile);
    }

    // Load/init state
    let state: BakeStateFile;
    if (opts.resume && existsSync(stateFile)) {
      state = JSON.parse(readFileSync(stateFile, 'utf-8')) as BakeStateFile;
      this.log(`Resuming from ${stateFile} — ${Object.values(state.jobs).filter((j) => j.state === 'done').length}/${clients.length} already done`);
    } else {
      state = {
        schemaVersion: 'site-to-mcp-bake-state/2026-05',
        agency: registry.agency.slug,
        startedAt,
        jobs: Object.fromEntries(clients.map((c) => [c.slug, { clientSlug: c.slug, state: 'pending' as const }])),
        resumable: true,
      };
      mkdirSync(resolve(stateFile, '..'), { recursive: true });
      writeFileSync(stateFile, JSON.stringify(state, null, 2));
    }

    // Filter clients: skip done if resume
    const toBake = clients.filter((c) => {
      if (!opts.resume) return true;
      const job = state.jobs[c.slug];
      return !job || job.state !== 'done';
    });

    this.log(`Baking ${toBake.length}/${clients.length} clients (concurrency: ${concurrency})`);

    // Pool z concurrency limit
    const totalStart = Date.now();
    const completedJobs: BakeJobStatus[] = [];
    const queue = [...toBake];
    const inFlight = new Set<Promise<void>>();

    const runOne = async (client: ClientEntry): Promise<void> => {
      const jobStart = Date.now();
      state.jobs[client.slug] = { clientSlug: client.slug, state: 'running', startedAt: new Date().toISOString() };
      writeFileSync(stateFile, JSON.stringify(state, null, 2));
      this.log(`  ▶ ${client.slug} (${client.name})`);

      try {
        // Per-client S2M instance
        const s2m = createSiteToMcp({
          siteUrl: client.siteUrl,
          brand: client.brand,
          aiBots: { ...(registry.defaults?.aiBots ?? {}), ...client.aiBots } as never,
        });

        // Per-client autopilot config (z credentialami klienta)
        const cfg: AutopilotConfig = {
          ...this.autopilotConfig,
          s2m,
          ...(client.credentials?.psiKey || this.autopilotConfig.google?.pageSpeedKey
            ? {
                google: {
                  ...(this.autopilotConfig.google ?? {}),
                  ...(client.credentials?.psiKey ? { pageSpeedKey: client.credentials.psiKey } : {}),
                  ...(client.credentials?.gscCredsPath ? { searchConsoleAuth: client.credentials.gscCredsPath } : {}),
                  ...(client.credentials?.indexingApiKeyPath ? { indexingApiKeyPath: client.credentials.indexingApiKeyPath } : {}),
                },
              }
            : {}),
        };

        const bakeDir = this.registry.bakeDirFor(client.slug);
        const orchestrator = new BakeOrchestrator(s2m, cfg);
        const manifest = await orchestrator.bake({
          site: client.siteUrl,
          outDir: bakeDir,
          maxPages: client.maxPages ?? registry.defaults?.maxPages ?? 100,
          ...(opts.refresh ? { refresh: true } : {}),
        });

        const job: BakeJobStatus = {
          clientSlug: client.slug,
          state: 'done',
          startedAt: state.jobs[client.slug]!.startedAt!,
          finishedAt: new Date().toISOString(),
          durationMs: Date.now() - jobStart,
          pagesBaked: manifest.totalPages,
          imagesGenerated: manifest.totalImages,
          bakedAt: manifest.bakedAt,
        };
        state.jobs[client.slug] = job;
        completedJobs.push(job);
        this.log(`  ✓ ${client.slug} — ${manifest.totalPages} pages, ${Math.round(job.durationMs! / 1000)}s`);
      } catch (err) {
        const job: BakeJobStatus = {
          clientSlug: client.slug,
          state: 'failed',
          startedAt: state.jobs[client.slug]!.startedAt!,
          finishedAt: new Date().toISOString(),
          durationMs: Date.now() - jobStart,
          error: String(err),
        };
        state.jobs[client.slug] = job;
        completedJobs.push(job);
        this.log(`  ✗ ${client.slug} — ${String(err).slice(0, 100)}`);
        if (opts.notifyWebhook) {
          await this.notify(opts.notifyWebhook, `Bake FAILED for ${client.slug}: ${err}`);
        }
      }

      writeFileSync(stateFile, JSON.stringify(state, null, 2));
    };

    while (queue.length > 0 || inFlight.size > 0) {
      while (queue.length > 0 && inFlight.size < concurrency) {
        const client = queue.shift()!;
        const promise = runOne(client).finally(() => inFlight.delete(promise));
        inFlight.add(promise);
      }
      if (inFlight.size > 0) {
        await Promise.race(inFlight);
      }
    }

    // Final result
    const succeeded = Object.values(state.jobs).filter((j) => j.state === 'done').length;
    const failed = Object.values(state.jobs).filter((j) => j.state === 'failed').length;
    const skipped = Object.values(state.jobs).filter((j) => j.state === 'skipped').length;
    const totalPagesBaked = Object.values(state.jobs).reduce((s, j) => s + (j.pagesBaked ?? 0), 0);
    const totalImagesGenerated = Object.values(state.jobs).reduce((s, j) => s + (j.imagesGenerated ?? 0), 0);
    const totalDurationMs = Date.now() - totalStart;

    if (opts.notifyWebhook) {
      await this.notify(opts.notifyWebhook, `Bulk bake done: ${succeeded}/${clients.length} succeeded, ${failed} failed. ${Math.round(totalDurationMs / 1000)}s total.`);
    }

    return {
      agency: registry.agency.name,
      startedAt,
      finishedAt: new Date().toISOString(),
      totalClients: clients.length,
      succeeded,
      failed,
      skipped,
      totalPagesBaked,
      totalImagesGenerated,
      totalDurationMs,
      jobs: Object.values(state.jobs),
      stateFile,
    };
  }

  private async notify(webhook: string, message: string): Promise<void> {
    try {
      await fetch(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: message }),
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      // silent fail
    }
  }

  private emptyResult(agency: string, startedAt: string, stateFile: string): BulkBakeResult {
    return {
      agency,
      startedAt,
      finishedAt: new Date().toISOString(),
      totalClients: 0,
      succeeded: 0,
      failed: 0,
      skipped: 0,
      totalPagesBaked: 0,
      totalImagesGenerated: 0,
      totalDurationMs: 0,
      jobs: [],
      stateFile,
    };
  }

  /**
   * Status z state file (bez bake'owania).
   */
  status(stateFile?: string): BakeStateFile | null {
    const path = stateFile ?? join(this.registry.portfolioDir(), '.bake-state.json');
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, 'utf-8')) as BakeStateFile;
  }
}
