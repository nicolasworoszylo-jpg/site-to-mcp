/**
 * Autopilot factory + orchestrator.
 *
 * Tworzy instance ze wszystkimi modułami, scheduler, storage, ollama.
 */

import type { SiteToMcp } from '@vidok/site-to-mcp';
import { AutopilotStorage } from './storage/db.js';
import { OllamaClient } from './ollama/client.js';
import type { AutopilotConfig, ModuleName, ModuleRunResult } from './types.js';
import {
  KeywordResearchModule,
  RankTrackerModule,
  AltGeneratorModule,
  ContentRewriterModule,
  InternalLinkingModule,
  BrokenLinksModule,
  BacklinkMonitorModule,
  CompetitorTrackerModule,
  ContentRefreshModule,
  GscSyncModule,
  PsiMonitorModule,
  IndexNowPushModule,
  HreflangValidatorModule,
  CanonicalValidatorModule,
  LighthouseAuditModule,
} from './modules/index.js';
import { Scheduler } from './scheduler/cron.js';
import { generateWeeklyReport } from './reports/markdown.js';

export class Autopilot {
  readonly config: AutopilotConfig;
  readonly storage: AutopilotStorage;
  readonly ollama: OllamaClient;
  readonly modules: {
    'keyword-research': KeywordResearchModule;
    'rank-tracker': RankTrackerModule;
    'alt-generator': AltGeneratorModule;
    'content-rewriter': ContentRewriterModule;
    'internal-linking': InternalLinkingModule;
    'broken-links': BrokenLinksModule;
    'backlink-monitor': BacklinkMonitorModule;
    'competitor-tracker': CompetitorTrackerModule;
    'content-refresh': ContentRefreshModule;
    'gsc-sync': GscSyncModule;
    'psi-monitor': PsiMonitorModule;
    'indexnow-push': IndexNowPushModule;
    'hreflang-validator': HreflangValidatorModule;
    'canonical-validator': CanonicalValidatorModule;
    'lighthouse-audit': LighthouseAuditModule;
  };
  private scheduler: Scheduler;

  constructor(config: AutopilotConfig) {
    this.config = config;
    this.storage = new AutopilotStorage(config.storage ?? './autopilot.db');
    this.ollama = new OllamaClient({
      ...(config.ollamaUrl ? { baseUrl: config.ollamaUrl } : {}),
      ...(config.ollamaModels ? { models: config.ollamaModels } : {}),
    });
    this.scheduler = new Scheduler(config.log);

    this.modules = {
      'keyword-research': new KeywordResearchModule(this.storage, config),
      'rank-tracker': new RankTrackerModule(this.storage, config),
      'alt-generator': new AltGeneratorModule(this.storage, config),
      'content-rewriter': new ContentRewriterModule(this.storage, config),
      'internal-linking': new InternalLinkingModule(this.storage, config),
      'broken-links': new BrokenLinksModule(this.storage, config),
      'backlink-monitor': new BacklinkMonitorModule(this.storage, config),
      'competitor-tracker': new CompetitorTrackerModule(this.storage, config),
      'content-refresh': new ContentRefreshModule(this.storage, config),
      'gsc-sync': new GscSyncModule(this.storage, config),
      'psi-monitor': new PsiMonitorModule(this.storage, config),
      'indexnow-push': new IndexNowPushModule(this.storage, config),
      'hreflang-validator': new HreflangValidatorModule(this.storage, config),
      'canonical-validator': new CanonicalValidatorModule(this.storage, config),
      'lighthouse-audit': new LighthouseAuditModule(this.storage, config),
    };
  }

  /**
   * Uruchomienie wybranego modułu manualnie.
   */
  async run<K extends ModuleName>(name: K, opts?: unknown): Promise<ModuleRunResult> {
    const mod = this.modules[name] as { run(opts?: unknown): Promise<ModuleRunResult> };
    return mod.run(opts);
  }

  /**
   * Sprawdza dostępność Ollamy + free APIs.
   */
  async healthCheck(): Promise<{ ollama: { ok: boolean; models: Record<string, boolean> }; google: { psi: boolean; gsc: boolean; indexing: boolean }; bing: { indexNow: boolean } }> {
    const ollama = await this.ollama.health();
    return {
      ollama: { ok: ollama.ok, models: ollama.modelsAvailable },
      google: {
        psi: !!this.config.google?.pageSpeedKey,
        gsc: !!this.config.google?.searchConsoleAuth,
        indexing: !!this.config.google?.indexingApiKeyPath,
      },
      bing: {
        indexNow: !!this.config.bing?.indexNowKey,
      },
    };
  }

  /**
   * Wpina moduły w scheduler wg config.schedule.
   */
  startScheduler(): void {
    const schedule = this.config.schedule ?? {};
    for (const [name, cron] of Object.entries(schedule)) {
      if (!cron) continue;
      this.scheduler.add({
        module: name as ModuleName,
        schedule: cron,
        run: () => this.run(name as ModuleName),
      });
    }
    this.scheduler.start();
  }

  stopScheduler(): void {
    this.scheduler.stop();
  }

  /**
   * Generuje weekly markdown report z historii.
   */
  report(opts?: { since?: string }): string {
    return generateWeeklyReport({
      storage: this.storage,
      ...(opts?.since ? { since: opts.since } : {}),
    });
  }

  /**
   * Zamyka storage (cleanup).
   */
  close(): void {
    this.scheduler.stop();
    this.storage.close();
  }
}

export function createAutopilot(config: AutopilotConfig): Autopilot {
  return new Autopilot(config);
}

/**
 * Helper: shortcut z `SiteToMcp` instance.
 */
export function autopilotFor(s2m: SiteToMcp, extra: Omit<AutopilotConfig, 's2m'> = {}): Autopilot {
  return createAutopilot({ s2m, ...extra });
}
