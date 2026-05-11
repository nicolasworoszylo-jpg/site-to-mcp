/**
 * BakedContentReader — runtime reader pre-computed danych z `seo-bake/`.
 *
 * Filozofia: plugin core w produkcji NIE wymaga Ollamy ani żadnego LLM.
 * Wszystko co AI-driven jest pre-computed RAZ przy bake i serwowane statycznie.
 *
 * Reader jest zero-dependency (tylko `fs` z Node). Działa wszędzie:
 * - Node 18+ (Next.js, Express, Astro)
 * - Cloudflare Workers (przez import.meta or KV namespace — wymagane custom adapter)
 *
 * Typowy lifecycle:
 *   1. Strona startuje
 *   2. BakedContentReader.load(bakeDir) — wczytuje manifest do pamięci
 *   3. Każdy request → reader.getPage(path) → instant lookup
 *   4. AI bot/markdown request → reader.getMarkdown(path) → pre-computed MD
 *   5. Schema injection → reader.getSchemaGraph(path) → pre-built JSON-LD
 *   6. Static endpoints → reader.getStaticFile('llms.txt') → bezpośrednio z dysku
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

export interface BakedManifest {
  schemaVersion: string;
  site: string;
  baseUrl: string;
  brand: string;
  pages: Array<{ path: string; hash: string; bakedAt: string }>;
  staticFiles: string[];
  bakedAt: string;
  totalPages: number;
  totalImages: number;
  models: { text: string; vision: string };
  durationMs: number;
}

export interface BakedPage {
  path: string;
  url: string;
  title: string;
  description?: string;
  schemaGraph: Record<string, unknown>;
  markdown: string;
  markdownTokens: number;
  altTexts: Record<string, string>;
  optimized?: {
    title?: string;
    description?: string;
    h1?: string;
  };
  qa: Array<{ question: string; answer: string }>;
  contentHash: string;
  bakedAt: string;
}

export class BakedContentReader {
  private manifest: BakedManifest;
  private pagesByPath = new Map<string, string>(); // path → filename
  private pageCache = new Map<string, BakedPage>(); // path → loaded data
  private staticCache = new Map<string, string>();

  constructor(private bakeDir: string) {
    const manifestPath = join(bakeDir, 'manifest.json');
    if (!existsSync(manifestPath)) {
      throw new Error(`Bake directory missing manifest.json: ${bakeDir}`);
    }
    this.manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as BakedManifest;
    this.indexPages();
  }

  private indexPages(): void {
    for (const p of this.manifest.pages) {
      const fname = pathHash(p.path) + '.json';
      this.pagesByPath.set(p.path, fname);
    }
  }

  /**
   * Sprawdź czy bake jest świeży (< maxAgeDays).
   */
  ageInDays(): number {
    return Math.floor((Date.now() - new Date(this.manifest.bakedAt).getTime()) / 86_400_000);
  }

  /**
   * Lista wszystkich zbakowanych ścieżek.
   */
  listPaths(): string[] {
    return [...this.pagesByPath.keys()];
  }

  /**
   * Pre-computed dane dla strony (lazy load + cache).
   */
  getPage(path: string): BakedPage | null {
    const cached = this.pageCache.get(path);
    if (cached) return cached;

    const fname = this.pagesByPath.get(path);
    if (!fname) return null;

    const filePath = join(this.bakeDir, 'pages', fname);
    if (!existsSync(filePath)) return null;

    try {
      const data = JSON.parse(readFileSync(filePath, 'utf-8')) as BakedPage;
      this.pageCache.set(path, data);
      return data;
    } catch {
      return null;
    }
  }

  /**
   * Sam markdown dla AI bot response (content negotiation).
   */
  getMarkdown(path: string): { content: string; tokens: number } | null {
    const page = this.getPage(path);
    if (!page) return null;
    return { content: page.markdown, tokens: page.markdownTokens };
  }

  /**
   * Schema @graph JSON-LD dla strony.
   */
  getSchemaGraph(path: string): Record<string, unknown> | null {
    const page = this.getPage(path);
    return page?.schemaGraph ?? null;
  }

  /**
   * Alt text dla obrazu (cache + lookup).
   */
  getAltText(imageSrc: string, pagePath?: string): string | null {
    if (pagePath) {
      const page = this.getPage(pagePath);
      if (page?.altTexts[imageSrc]) return page.altTexts[imageSrc];
    }
    // Fallback: szukaj w innych stronach (każdy obraz mógł być wygenerowany raz)
    for (const path of this.pagesByPath.keys()) {
      const page = this.getPage(path);
      if (page?.altTexts[imageSrc]) return page.altTexts[imageSrc];
    }
    return null;
  }

  /**
   * Zoptymalizowane meta (jeśli rewrite uruchomione przy bake).
   */
  getOptimized(path: string): BakedPage['optimized'] | null {
    const page = this.getPage(path);
    return page?.optimized ?? null;
  }

  /**
   * Q&A pairs dla strony.
   */
  getQA(path: string): Array<{ question: string; answer: string }> {
    return this.getPage(path)?.qa ?? [];
  }

  /**
   * Statyczny plik z bake (llms.txt, robots.txt itd.).
   */
  getStaticFile(name: string): string | null {
    const cached = this.staticCache.get(name);
    if (cached !== undefined) return cached;

    const filePath = join(this.bakeDir, name);
    if (!existsSync(filePath)) return null;

    try {
      const content = readFileSync(filePath, 'utf-8');
      this.staticCache.set(name, content);
      return content;
    } catch {
      return null;
    }
  }

  /**
   * Manifest do introspekcji (stats, age, models użyte).
   */
  getManifest(): BakedManifest {
    return this.manifest;
  }

  /**
   * Wykrywa czy strona została zbakowana — używane w fallback.
   */
  has(path: string): boolean {
    return this.pagesByPath.has(path);
  }
}

function pathHash(path: string): string {
  return createHash('sha256').update(path).digest('hex').slice(0, 16);
}

/**
 * Helper: load reader bezpiecznie. Zwraca null jeśli bake brak.
 * Plugin core używa tego patternu w adapters — jeśli null, fallback do dynamic generation.
 */
export function loadBakedContent(bakeDir: string): BakedContentReader | null {
  try {
    if (!existsSync(bakeDir) || !existsSync(join(bakeDir, 'manifest.json'))) {
      return null;
    }
    return new BakedContentReader(bakeDir);
  } catch {
    return null;
  }
}
