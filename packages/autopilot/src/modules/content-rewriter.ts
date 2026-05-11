/**
 * Module: Content Rewriter.
 *
 * Lokalny Ollama qwen2.5:14b rewrites title/meta-description/H1 wg target keyword
 * + intent + Google SEO limits (title 50-60, meta 140-160).
 */

import type { Module, ModuleRunResult, AutopilotConfig } from '../types.js';
import type { AutopilotStorage } from '../storage/db.js';
import { OllamaClient } from '../ollama/client.js';

export interface ContentRewriterOpts {
  /** Current values */
  currentTitle?: string;
  currentMetaDescription?: string;
  currentH1?: string;
  /** Target keyword */
  targetKeyword: string;
  /** Intent: informational / commercial / transactional / navigational */
  intent?: 'informational' | 'commercial' | 'transactional' | 'navigational';
  /** Page topic context (1-2 sentences) */
  context?: string;
  language?: string;
}

export interface RewriteResult {
  title?: string;
  metaDescription?: string;
  h1?: string;
}

export class ContentRewriterModule implements Module<ContentRewriterOpts> {
  name = 'content-rewriter' as const;
  description = 'Ollama qwen rewrites title/meta/H1 z target keyword + intent.';
  requires = ['ollama.text'];

  private ollama: OllamaClient;

  constructor(private storage: AutopilotStorage, cfg: AutopilotConfig) {
    this.ollama = new OllamaClient({
      ...(cfg.ollamaUrl ? { baseUrl: cfg.ollamaUrl } : {}),
      ...(cfg.ollamaModels ? { models: cfg.ollamaModels } : {}),
    });
  }

  async run(opts?: ContentRewriterOpts): Promise<ModuleRunResult> {
    const startedAt = new Date().toISOString();
    const start = Date.now();
    const o = opts ?? { targetKeyword: '' };
    if (!o.targetKeyword) {
      return this.fail(startedAt, start, 'Missing targetKeyword');
    }
    const lang = o.language ?? 'pl';
    const intent = o.intent ?? 'informational';

    try {
      const rewritten: RewriteResult = {};
      let changed = 0;

      if (o.currentTitle) {
        const prompt = this.titlePrompt(o.currentTitle, o.targetKeyword, intent, lang, o.context);
        const result = await this.ollama.generate(prompt, { temperature: 0.4, maxTokens: 100 });
        const cleaned = this.cleanLine(result);
        if (cleaned && cleaned !== o.currentTitle && cleaned.length >= 30 && cleaned.length <= 70) {
          rewritten.title = cleaned;
          changed++;
        }
      }

      if (o.currentMetaDescription || (o.currentTitle && !o.currentMetaDescription)) {
        const prompt = this.metaPrompt(o.currentMetaDescription ?? '', o.targetKeyword, intent, lang, o.context);
        const result = await this.ollama.generate(prompt, { temperature: 0.5, maxTokens: 150 });
        const cleaned = this.cleanLine(result);
        if (cleaned && cleaned.length >= 100 && cleaned.length <= 170) {
          rewritten.metaDescription = cleaned;
          changed++;
        }
      }

      if (o.currentH1) {
        const prompt = this.h1Prompt(o.currentH1, o.targetKeyword, intent, lang, o.context);
        const result = await this.ollama.generate(prompt, { temperature: 0.3, maxTokens: 80 });
        const cleaned = this.cleanLine(result);
        if (cleaned && cleaned !== o.currentH1 && cleaned.length <= 80) {
          rewritten.h1 = cleaned;
          changed++;
        }
      }

      const finishedAt = new Date().toISOString();
      const result: ModuleRunResult = {
        module: 'content-rewriter',
        startedAt,
        finishedAt,
        durationMs: Date.now() - start,
        ok: true,
        itemsProcessed: 3,
        itemsChanged: changed,
        summary: `Rewritten ${changed}/3 elements for keyword "${o.targetKeyword}"`,
        data: rewritten,
      };
      this.storage.logRun(result);
      return result;
    } catch (err) {
      return this.fail(startedAt, start, String(err));
    }
  }

  private titlePrompt(current: string, kw: string, intent: string, lang: string, context?: string): string {
    return `You are an SEO copywriter. Rewrite this HTML title for better Google + AI search visibility.

Current title: "${current}"
Target keyword: "${kw}"
Intent: ${intent}
Language: ${lang}
${context ? `Context: ${context}` : ''}

Rules:
- 50-60 characters MAX
- Include target keyword near the beginning
- Match the intent (informational = "Co to / Jak", commercial = "Najlepsze / Porównanie", transactional = "Kup / Cena")
- Natural language, no keyword stuffing
- Output ONLY the new title text, no quotes, no preamble.`;
  }

  private metaPrompt(current: string, kw: string, intent: string, lang: string, context?: string): string {
    return `You are an SEO copywriter. ${current ? 'Rewrite' : 'Write'} this meta description for better Google + AI search.

${current ? `Current: "${current}"` : ''}
Target keyword: "${kw}"
Intent: ${intent}
Language: ${lang}
${context ? `Context: ${context}` : ''}

Rules:
- 140-160 characters MAX
- Include target keyword and a call-to-action
- One sentence preferred
- Match the intent
- Output ONLY the meta description text, no quotes.`;
  }

  private h1Prompt(current: string, kw: string, intent: string, lang: string, context?: string): string {
    return `You are an SEO copywriter. Rewrite this H1 heading.

Current H1: "${current}"
Target keyword: "${kw}"
Intent: ${intent}
Language: ${lang}
${context ? `Context: ${context}` : ''}

Rules:
- Should answer the search query if intent is informational
- 30-70 characters
- For informational queries, prefer question form (78.4% cited content has question headings)
- Output ONLY the new H1, no quotes, no preamble.`;
  }

  private cleanLine(text: string): string {
    return text
      .trim()
      .split('\n')[0]
      ?.replace(/^["'`]+|["'`]+$/g, '')
      .replace(/^(Title|Meta|H1|Heading):\s*/i, '')
      .trim() ?? '';
  }

  private fail(startedAt: string, start: number, error: string): ModuleRunResult {
    const finishedAt = new Date().toISOString();
    const result: ModuleRunResult = {
      module: 'content-rewriter',
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
