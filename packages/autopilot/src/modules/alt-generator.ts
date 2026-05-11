/**
 * Module: Image Alt Generator.
 *
 * Zero-cost: lokalny Ollama llama3.2-vision generuje alt text dla każdego
 * obrazu który nie ma alt lub ma generic alt ("image", "img", "photo").
 *
 * Iron law: nigdy nie nadpisuje istniejącego sensownego alt.
 */

import { load } from 'cheerio';
import type { Module, ModuleRunResult, AutopilotConfig } from '../types.js';
import type { AutopilotStorage } from '../storage/db.js';
import { OllamaClient } from '../ollama/client.js';

export interface AltGeneratorOpts {
  /** HTML do przetwarzania (string albo URL) */
  html?: string;
  pageUrl?: string;
  /** Jeśli URL — fetch + przetwarzaj */
  url?: string;
  /** Czy nadpisywać istniejący alt (default: tylko gdy generic/empty) */
  overwrite?: boolean;
}

const GENERIC_ALT = /^(image|img|photo|picture|zdjęcie|obrazek|untitled|placeholder|.{0,2})$/i;

export class AltGeneratorModule implements Module<AltGeneratorOpts> {
  name = 'alt-generator' as const;
  description = 'Ollama llama3.2-vision alt text generator (lokalnie, $0).';
  requires = ['ollama.vision'];

  private ollama: OllamaClient;

  constructor(private storage: AutopilotStorage, cfg: AutopilotConfig) {
    this.ollama = new OllamaClient({
      ...(cfg.ollamaUrl ? { baseUrl: cfg.ollamaUrl } : {}),
      ...(cfg.ollamaModels ? { models: cfg.ollamaModels } : {}),
    });
  }

  async run(opts?: AltGeneratorOpts): Promise<ModuleRunResult> {
    const startedAt = new Date().toISOString();
    const start = Date.now();
    const o = opts ?? {};
    const now = new Date().toISOString();

    try {
      let html: string;
      let pageUrl: string;
      if (o.url) {
        const res = await fetch(o.url, { signal: AbortSignal.timeout(15_000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        html = await res.text();
        pageUrl = o.url;
      } else if (o.html) {
        html = o.html;
        pageUrl = o.pageUrl ?? '';
      } else {
        return this.fail(startedAt, start, 'Missing url or html');
      }

      const $ = load(html);
      const candidates: Array<{ src: string; existing: string }> = [];
      $('img').each((_, el) => {
        const src = $(el).attr('src');
        const existing = ($(el).attr('alt') ?? '').trim();
        if (!src) return;
        if (existing && !GENERIC_ALT.test(existing) && !o.overwrite) return;
        candidates.push({ src, existing });
      });

      let processed = 0;
      let changed = 0;
      const results: Array<{ src: string; alt: string }> = [];

      for (const c of candidates) {
        processed++;
        // Check cache
        const cached = this.storage.getAltText(c.src);
        if (cached) {
          $('img[src="' + escapeAttr(c.src) + '"]').attr('alt', cached.altText);
          changed++;
          results.push({ src: c.src, alt: cached.altText });
          continue;
        }
        const absoluteSrc = c.src.startsWith('http') ? c.src : pageUrl ? new URL(c.src, pageUrl).toString() : c.src;
        try {
          const alt = await this.ollama.describeImage(absoluteSrc);
          if (alt && alt.length > 3) {
            this.storage.upsertAltText({
              imageSrc: c.src,
              altText: alt,
              pageUrl: pageUrl ?? '',
              generatedAt: now,
              model: 'llama3.2-vision:11b',
            });
            $('img[src="' + escapeAttr(c.src) + '"]').attr('alt', alt);
            changed++;
            results.push({ src: c.src, alt });
          }
        } catch (err) {
          // skip — log w summary
          results.push({ src: c.src, alt: `[error: ${String(err).slice(0, 40)}]` });
        }
      }

      const finishedAt = new Date().toISOString();
      const result: ModuleRunResult = {
        module: 'alt-generator',
        startedAt,
        finishedAt,
        durationMs: Date.now() - start,
        ok: true,
        itemsProcessed: processed,
        itemsChanged: changed,
        summary: `Generated alt for ${changed}/${processed} images on ${pageUrl || 'inline html'}`,
        data: { html: $.html(), results },
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
      module: 'alt-generator',
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

function escapeAttr(s: string): string {
  return s.replace(/"/g, '\\"');
}
