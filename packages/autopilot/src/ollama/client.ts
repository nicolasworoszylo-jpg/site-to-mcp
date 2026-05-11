/**
 * Ollama client — wrapper na local LLM endpoint.
 *
 * Trzy capabilities:
 *   - text: generate / chat (qwen2.5:14b default)
 *   - embed: embeddings (nomic-embed-text default)
 *   - vision: image description (llama3.2-vision:11b default)
 *
 * Wszystko lokalnie, $0. Nicolas ma Ollama zainstalowane.
 *
 * Endpoint default: http://localhost:11434 (Ollama default port).
 */

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

export interface OllamaClientOpts {
  baseUrl?: string;
  models?: {
    text?: string;
    vision?: string;
    embed?: string;
  };
  /** Timeout per request (ms) — vision może być wolne (30s+) */
  timeoutMs?: number;
}

export class OllamaClient {
  private baseUrl: string;
  private models: { text: string; vision: string; embed: string };
  private timeoutMs: number;

  constructor(opts: OllamaClientOpts = {}) {
    this.baseUrl = opts.baseUrl ?? 'http://localhost:11434';
    this.models = {
      text: opts.models?.text ?? 'qwen2.5:14b',
      vision: opts.models?.vision ?? 'llama3.2-vision:11b',
      embed: opts.models?.embed ?? 'nomic-embed-text',
    };
    this.timeoutMs = opts.timeoutMs ?? 60_000;
  }

  /**
   * Sprawdza czy Ollama jest dostępny + czy modele są zainstalowane.
   */
  async health(): Promise<{ ok: boolean; modelsAvailable: Record<string, boolean>; error?: string }> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) return { ok: false, modelsAvailable: {}, error: `HTTP ${res.status}` };
      const json = (await res.json()) as { models?: Array<{ name: string }> };
      const installed = new Set((json.models ?? []).map((m) => m.name));
      const modelsAvailable: Record<string, boolean> = {};
      for (const [role, model] of Object.entries(this.models)) {
        modelsAvailable[role] = installed.has(model) || [...installed].some((i) => i.startsWith(model.split(':')[0] + ':'));
      }
      return { ok: true, modelsAvailable };
    } catch (err) {
      return { ok: false, modelsAvailable: {}, error: String(err) };
    }
  }

  /**
   * Generuje tekst z prompt'a (zwykły text-completion).
   */
  async generate(prompt: string, opts: { model?: string; system?: string; temperature?: number; maxTokens?: number } = {}): Promise<string> {
    const body = {
      model: opts.model ?? this.models.text,
      prompt,
      ...(opts.system ? { system: opts.system } : {}),
      stream: false,
      options: {
        temperature: opts.temperature ?? 0.3,
        num_predict: opts.maxTokens ?? 512,
      },
    };
    const res = await fetch(`${this.baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) throw new Error(`Ollama generate failed: HTTP ${res.status}`);
    const json = (await res.json()) as { response?: string };
    return json.response ?? '';
  }

  /**
   * Opis obrazu (image → text) przez llama3.2-vision.
   */
  async describeImage(imagePathOrUrl: string, opts: { prompt?: string; maxTokens?: number } = {}): Promise<string> {
    let imageB64: string;
    if (imagePathOrUrl.startsWith('http')) {
      const res = await fetch(imagePathOrUrl, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(`Image fetch failed: ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      imageB64 = buf.toString('base64');
    } else {
      imageB64 = readFileSync(imagePathOrUrl).toString('base64');
    }

    const prompt = opts.prompt ?? 'Describe this image concisely in one short sentence suitable for an HTML alt attribute. Focus on what is depicted, not the style. Output only the description, no preamble.';

    const body = {
      model: this.models.vision,
      prompt,
      images: [imageB64],
      stream: false,
      options: { temperature: 0.2, num_predict: opts.maxTokens ?? 80 },
    };
    const res = await fetch(`${this.baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs * 2),
    });
    if (!res.ok) throw new Error(`Ollama vision failed: HTTP ${res.status}`);
    const json = (await res.json()) as { response?: string };
    return (json.response ?? '').trim().replace(/^["']+|["']+$/g, '');
  }

  /**
   * Embedding — wektor liczb (768 dim dla nomic-embed-text).
   */
  async embed(text: string): Promise<number[]> {
    const body = { model: this.models.embed, prompt: text };
    const res = await fetch(`${this.baseUrl}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) throw new Error(`Ollama embed failed: HTTP ${res.status}`);
    const json = (await res.json()) as { embedding?: number[] };
    if (!json.embedding) throw new Error('Ollama embed returned no embedding');
    return json.embedding;
  }
}

/**
 * Cosine similarity między dwoma wektorami.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    na += av * av;
    nb += bv * bv;
  }
  return na === 0 || nb === 0 ? 0 : dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}
