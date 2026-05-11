/**
 * Module: Internal Linking.
 *
 * Lokalny Ollama nomic-embed-text embedduje wszystkie strony, znajduje
 * semantycznie podobne pary, proponuje anchor + target.
 *
 * Iron law: zwraca PROPOZYCJE, nie modyfikuje stron. User akceptuje.
 */

import type { Module, ModuleRunResult, AutopilotConfig, InternalLinkSuggestion } from '../types.js';
import type { AutopilotStorage } from '../storage/db.js';
import { OllamaClient, cosineSimilarity, hashText } from '../ollama/client.js';

export interface InternalLinkingOpts {
  /** Lista stron z treścią */
  pages: Array<{ url: string; title: string; content: string }>;
  /** Minimum similarity 0-1 (default 0.7) */
  threshold?: number;
  /** Max propozycje per strona */
  maxPerPage?: number;
}

export class InternalLinkingModule implements Module<InternalLinkingOpts> {
  name = 'internal-linking' as const;
  description = 'Semantic internal linking via Ollama embeddings.';
  requires = ['ollama.embed'];

  private ollama: OllamaClient;

  constructor(private storage: AutopilotStorage, cfg: AutopilotConfig) {
    this.ollama = new OllamaClient({
      ...(cfg.ollamaUrl ? { baseUrl: cfg.ollamaUrl } : {}),
      ...(cfg.ollamaModels ? { models: cfg.ollamaModels } : {}),
    });
  }

  async run(opts?: InternalLinkingOpts): Promise<ModuleRunResult> {
    const startedAt = new Date().toISOString();
    const start = Date.now();
    const o = opts ?? { pages: [] };
    if (!o.pages?.length) return this.fail(startedAt, start, 'Missing pages');

    const threshold = o.threshold ?? 0.7;
    const maxPerPage = o.maxPerPage ?? 5;
    const now = new Date().toISOString();

    try {
      // 1. Embed wszystkie strony (cache w SQLite by text_hash)
      const existing = new Map(this.storage.listEmbeddings().map((e) => [e.url, e]));
      const embeddings = new Map<string, { vec: number[]; title: string }>();

      for (const p of o.pages) {
        const text = `${p.title}\n\n${p.content.slice(0, 4000)}`;
        const h = hashText(text);
        const cached = existing.get(p.url);
        if (cached && cached.textHash === h) {
          embeddings.set(p.url, { vec: cached.embedding, title: p.title });
        } else {
          const vec = await this.ollama.embed(text);
          this.storage.upsertEmbedding(p.url, vec, h, 'nomic-embed-text');
          embeddings.set(p.url, { vec, title: p.title });
        }
      }

      // 2. All-pairs cosine similarity → top N per page
      const suggestions: InternalLinkSuggestion[] = [];
      for (const [fromUrl, from] of embeddings) {
        const scores: Array<{ url: string; sim: number; title: string }> = [];
        for (const [toUrl, to] of embeddings) {
          if (fromUrl === toUrl) continue;
          const sim = cosineSimilarity(from.vec, to.vec);
          if (sim >= threshold) scores.push({ url: toUrl, sim, title: to.title });
        }
        scores.sort((a, b) => b.sim - a.sim);
        for (const s of scores.slice(0, maxPerPage)) {
          suggestions.push({
            fromPage: fromUrl,
            toPage: s.url,
            similarity: s.sim,
            proposedAnchor: s.title,
            suggestedAt: now,
          });
        }
      }

      for (const s of suggestions) this.storage.upsertInternalLinkSuggestion(s);

      const finishedAt = new Date().toISOString();
      const result: ModuleRunResult = {
        module: 'internal-linking',
        startedAt,
        finishedAt,
        durationMs: Date.now() - start,
        ok: true,
        itemsProcessed: o.pages.length,
        itemsChanged: suggestions.length,
        summary: `Proposed ${suggestions.length} links across ${o.pages.length} pages (threshold ${threshold})`,
        data: { suggestions },
      };
      this.storage.logRun(result);
      return result;
    } catch (err) {
      return this.fail(startedAt, start, String(err));
    }
  }

  private fail(startedAt: string, start: number, error: string): ModuleRunResult {
    const finishedAt = new Date().toISOString();
    const result: ModuleRunResult = {
      module: 'internal-linking',
      startedAt,
      finishedAt,
      durationMs: Date.now() - start,
      ok: false,
      itemsProcessed: 0,
      error,
    };
    this.storage.logRun(result);
    return result;
  }
}
