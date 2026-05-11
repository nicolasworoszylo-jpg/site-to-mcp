/**
 * Module: Content Refresh Detector.
 *
 * Pages 30-89 dni performują najlepiej (research). Flaguje strony >120 dni
 * jako kandydaci do refresh + LLM proponuje co dodać/zmienić.
 */

import type { Module, ModuleRunResult, AutopilotConfig, RefreshSuggestion } from '../types.js';
import type { AutopilotStorage } from '../storage/db.js';
import { OllamaClient } from '../ollama/client.js';

export interface ContentRefreshOpts {
  pages: Array<{ url: string; lastModified: string; title: string; content: string }>;
  /** Days threshold (default 120) */
  thresholdDays?: number;
}

export class ContentRefreshModule implements Module<ContentRefreshOpts> {
  name = 'content-refresh' as const;
  description = 'Flaguje stare strony + LLM proponuje update.';
  requires = ['ollama.text'];

  private ollama: OllamaClient;

  constructor(private storage: AutopilotStorage, cfg: AutopilotConfig) {
    this.ollama = new OllamaClient({
      ...(cfg.ollamaUrl ? { baseUrl: cfg.ollamaUrl } : {}),
      ...(cfg.ollamaModels ? { models: cfg.ollamaModels } : {}),
    });
  }

  async run(opts?: ContentRefreshOpts): Promise<ModuleRunResult> {
    const startedAt = new Date().toISOString();
    const start = Date.now();
    const o = opts ?? { pages: [] };
    if (!o.pages?.length) return this.fail(startedAt, start, 'Missing pages');

    const threshold = o.thresholdDays ?? 120;
    const now = Date.now();
    const nowIso = new Date().toISOString();
    const suggestions: RefreshSuggestion[] = [];

    for (const p of o.pages) {
      const ageMs = now - new Date(p.lastModified).getTime();
      const ageDays = Math.floor(ageMs / 86_400_000);
      if (ageDays < threshold) continue;

      try {
        const prompt = `You are an SEO content strategist. This page is ${ageDays} days old and likely needs refresh.

Title: ${p.title}
Content excerpt (first 1500 chars): ${p.content.slice(0, 1500)}

In 3 short bullet points, suggest specific updates:
1. New section to add (with subhead)
2. Outdated claim/stat to replace
3. New angle/question to address

Output ONLY the 3 bullet points, no preamble.`;

        const suggestion = await this.ollama.generate(prompt, { temperature: 0.5, maxTokens: 300 });
        const rec: RefreshSuggestion = {
          url: p.url,
          lastModified: p.lastModified,
          ageDays,
          suggestion: suggestion.trim(),
          suggestedAt: nowIso,
        };
        this.storage.insertRefreshSuggestion(rec);
        suggestions.push(rec);
      } catch {
        // skip
      }
    }

    const finishedAt = new Date().toISOString();
    const result: ModuleRunResult = {
      module: 'content-refresh', startedAt, finishedAt,
      durationMs: Date.now() - start, ok: true,
      itemsProcessed: o.pages.length, itemsChanged: suggestions.length,
      summary: `${suggestions.length} pages flagged for refresh (>${threshold} days old)`,
      data: { suggestions },
    };
    this.storage.logRun(result);
    return result;
  }

  private fail(startedAt: string, start: number, error: string): ModuleRunResult {
    const finishedAt = new Date().toISOString();
    const result: ModuleRunResult = {
      module: 'content-refresh', startedAt, finishedAt,
      durationMs: Date.now() - start, ok: false, itemsProcessed: 0, error,
    };
    this.storage.logRun(result);
    return result;
  }
}
