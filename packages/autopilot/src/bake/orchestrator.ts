/**
 * Bake orchestrator — one-shot pre-computation wszystkiego co da się statycznie.
 *
 * Workflow:
 *   1. Crawl strony klienta (sitemap.xml albo breadth-first od homepage)
 *   2. Dla każdej strony:
 *      - extract content (HTML → markdown)
 *      - Ollama vision: alt-texts dla każdego obrazu (lokalnie, $0)
 *      - Ollama text: optimized title/meta/H1 (lokalnie, $0)
 *      - Extract Q&A pairs (LLM + FAQPage schema)
 *      - Build complete @graph (Organization+WebSite+Article+FAQPage+Person)
 *      - Generate markdown response (cached)
 *   3. Aggregate static files:
 *      - llms.txt, llms-full.txt
 *      - robots.txt, sitemap.xml
 *      - .well-known/agent-card.json, .well-known/mcp.json
 *      - skill.md, AGENTS.md, _headers, ai.txt
 *   4. Output do `<outDir>/seo-bake/`:
 *      - manifest.json — globalne metadata + index per page
 *      - <static-files>
 *      - pages/<path-hash>.json — pre-computed per page
 *      - images/<src-hash>.json — alt-texts cache
 *
 * Po bake — klient deployuje `seo-bake/` razem ze stroną.
 * Plugin core (BakedContentReader) czyta pliki przy starcie i serwuje.
 * Ollama już niepotrzebna — strona "żyje własnym życiem".
 */

import { load } from 'cheerio';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import type { SiteToMcp } from '@vidok/site-to-mcp';
import { extractContent } from '@vidok/site-to-mcp';
import { OllamaClient } from '../ollama/client.js';
import type { AutopilotConfig } from '../types.js';

export interface BakeOptions {
  /** URL serwisu do bake (np. https://example.com) */
  site: string;
  /** Output directory (np. ./seo-bake) */
  outDir: string;
  /** Konkretne ścieżki (jeśli brak — crawl sitemap albo BFS) */
  paths?: string[];
  /** Max stron do crawlowania (default 100) */
  maxPages?: number;
  /** Moduły do uruchomienia (default: wszystkie) */
  modules?: Array<'alt' | 'rewrite' | 'faq' | 'schema' | 'markdown'>;
  /** Refresh mode — bake tylko strony których content_hash się zmienił */
  refresh?: boolean;
  /** Lang strony (default pl-PL) */
  lang?: string;
  /** Verbose log */
  log?: (msg: string) => void;
}

export interface BakedPage {
  path: string;
  url: string;
  title: string;
  description?: string;
  /** Schema.org @graph JSON-LD (gotowy do <script>) */
  schemaGraph: Record<string, unknown>;
  /** Pre-rendered markdown wersja dla AI botów (z tokens count) */
  markdown: string;
  markdownTokens: number;
  /** Wygenerowane alt texts: imageSrc → altText */
  altTexts: Record<string, string>;
  /** Optimized meta (jeśli rewrite uruchomione) */
  optimized?: {
    title?: string;
    description?: string;
    h1?: string;
  };
  /** Wyciągnięte Q&A pairs (FAQPage candidates) */
  qa: Array<{ question: string; answer: string }>;
  /** Hash treści — do detekcji zmian w refresh mode */
  contentHash: string;
  bakedAt: string;
}

export interface BakeManifest {
  schemaVersion: 'site-to-mcp-bake/2026-05';
  site: string;
  baseUrl: string;
  brand: string;
  pages: Array<{ path: string; hash: string; bakedAt: string }>;
  staticFiles: string[];
  bakedAt: string;
  totalPages: number;
  totalImages: number;
  /** Ollama models used */
  models: { text: string; vision: string };
  /** Ile czasu zajęło bake */
  durationMs: number;
}

export class BakeOrchestrator {
  private ollama: OllamaClient;
  private log: (msg: string) => void;

  constructor(
    private s2m: SiteToMcp,
    private cfg: AutopilotConfig,
  ) {
    this.ollama = new OllamaClient({
      ...(cfg.ollamaUrl ? { baseUrl: cfg.ollamaUrl } : {}),
      ...(cfg.ollamaModels ? { models: cfg.ollamaModels } : {}),
    });
    this.log = cfg.log ?? ((m: string) => console.log(`[bake] ${m}`));
  }

  async bake(opts: BakeOptions): Promise<BakeManifest> {
    const start = Date.now();
    const modules = new Set(opts.modules ?? ['alt', 'rewrite', 'faq', 'schema', 'markdown']);
    this.log(`Starting bake for ${opts.site}`);

    // 1. Verify Ollama
    const health = await this.ollama.health();
    if (!health.ok) throw new Error(`Ollama not reachable: ${health.error}`);
    this.log(`Ollama ✓ (models: ${Object.entries(health.modelsAvailable).filter(([, v]) => v).map(([k]) => k).join(', ')})`);

    // 2. Discover pages
    const paths = opts.paths ?? (await this.discoverPages(opts.site, opts.maxPages ?? 100));
    this.log(`Discovered ${paths.length} pages`);

    // 3. Setup output dirs
    const dirs = ['', 'pages', 'images'];
    for (const d of dirs) {
      const full = join(opts.outDir, d);
      if (!existsSync(full)) mkdirSync(full, { recursive: true });
    }

    // 4. Bake each page
    const bakedPages: BakedPage[] = [];
    let totalImages = 0;
    for (let i = 0; i < paths.length; i++) {
      const path = paths[i];
      if (!path) continue;
      this.log(`[${i + 1}/${paths.length}] ${path}`);
      try {
        const baked = await this.bakePage(opts.site, path, modules, opts.lang ?? 'pl-PL', opts.refresh ?? false, opts.outDir);
        if (baked) {
          bakedPages.push(baked);
          totalImages += Object.keys(baked.altTexts).length;
          // Zapisz per-page JSON
          const fname = pathHash(path) + '.json';
          writeFileSync(join(opts.outDir, 'pages', fname), JSON.stringify(baked, null, 2));
        }
      } catch (err) {
        this.log(`  ! page failed: ${err}`);
      }
    }

    // 5. Aggregate static files
    const staticFiles: string[] = [];
    const writeStatic = (name: string, content: string): void => {
      const p = join(opts.outDir, name);
      if (dirname(name) !== '.') mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, content);
      staticFiles.push(name);
    };

    // Set up PageIndex w core
    for (const p of bakedPages) {
      this.s2m.pageIndex.add({
        url: p.url,
        path: p.path,
        title: p.optimized?.title ?? p.title,
        ...(p.description ? { description: p.description } : {}),
        ...(opts.lang ? { lang: opts.lang } : {}),
        tokens: p.markdownTokens,
        preview: { headings: [{ level: 1, text: p.optimized?.h1 ?? p.title }] },
      });
    }

    writeStatic('llms.txt', this.s2m.generateLlmsTxt());
    writeStatic('llms-full.txt', this.s2m.generateLlmsFullTxt({
      pages: bakedPages.map((p) => ({ url: p.url, title: p.title, markdown: p.markdown, tokens: p.markdownTokens })),
    }).content);
    writeStatic('robots.txt', this.s2m.generateRobotsTxt());
    writeStatic('sitemap.xml', this.s2m.generateSitemapXml());
    writeStatic('skill.md', this.s2m.generateSkillMd());
    writeStatic('AGENTS.md', this.s2m.generateAgentsMd());
    writeStatic('_headers', this.s2m.generateHeadersFile());
    writeStatic('ai.txt', this.s2m.generateAiTxt());
    writeStatic('.well-known/agent-card.json', this.s2m.generateAgentCard());
    writeStatic('.well-known/mcp.json', JSON.stringify(this.s2m.createMCPServer().manifest(), null, 2));

    // 6. Manifest
    const manifest: BakeManifest = {
      schemaVersion: 'site-to-mcp-bake/2026-05',
      site: opts.site,
      baseUrl: opts.site,
      brand: this.s2m.config.brand.name,
      pages: bakedPages.map((p) => ({ path: p.path, hash: p.contentHash, bakedAt: p.bakedAt })),
      staticFiles,
      bakedAt: new Date().toISOString(),
      totalPages: bakedPages.length,
      totalImages,
      models: {
        text: this.cfg.ollamaModels?.text ?? 'qwen2.5:14b',
        vision: this.cfg.ollamaModels?.vision ?? 'llama3.2-vision:11b',
      },
      durationMs: Date.now() - start,
    };
    writeFileSync(join(opts.outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

    this.log(`✓ Bake complete: ${bakedPages.length} pages, ${totalImages} images, ${staticFiles.length} static files in ${Math.round(manifest.durationMs / 1000)}s`);
    this.log(`  Output: ${opts.outDir}`);
    this.log(`  Deploy this folder alongside your site — strona "żyje własnym życiem".`);

    return manifest;
  }

  // ==========================================================================
  // Page discovery
  // ==========================================================================

  private async discoverPages(siteUrl: string, max: number): Promise<string[]> {
    const baseUrl = new URL(siteUrl);
    const found = new Set<string>(['/']);

    // 1. Try sitemap.xml
    try {
      const res = await fetch(new URL('/sitemap.xml', baseUrl).toString(), {
        signal: AbortSignal.timeout(15_000),
      });
      if (res.ok) {
        const xml = await res.text();
        const matches = xml.match(/<loc>([^<]+)<\/loc>/g) ?? [];
        for (const m of matches) {
          const url = m.replace(/<\/?loc>/g, '').trim();
          try {
            const u = new URL(url);
            if (u.hostname === baseUrl.hostname) {
              found.add(u.pathname);
            }
          } catch {
            // skip
          }
          if (found.size >= max) break;
        }
        if (found.size > 1) {
          this.log(`  sitemap.xml: ${found.size} pages`);
          return [...found].slice(0, max);
        }
      }
    } catch {
      // fall through to BFS
    }

    // 2. BFS od homepage (max 2 hops)
    this.log(`  No sitemap; BFS from homepage`);
    const queue: Array<{ path: string; depth: number }> = [{ path: '/', depth: 0 }];
    while (queue.length > 0 && found.size < max) {
      const item = queue.shift()!;
      if (item.depth > 2) continue;
      try {
        const res = await fetch(new URL(item.path, baseUrl).toString(), { signal: AbortSignal.timeout(10_000) });
        if (!res.ok) continue;
        const $ = load(await res.text());
        $('a[href]').each((_, el) => {
          const href = $(el).attr('href');
          if (!href) return;
          try {
            const u = new URL(href, new URL(item.path, baseUrl));
            if (u.hostname === baseUrl.hostname && !found.has(u.pathname)) {
              found.add(u.pathname);
              queue.push({ path: u.pathname, depth: item.depth + 1 });
            }
          } catch {
            // skip
          }
        });
      } catch {
        // skip
      }
    }
    return [...found].slice(0, max);
  }

  // ==========================================================================
  // Per-page bake
  // ==========================================================================

  private async bakePage(
    site: string,
    path: string,
    modules: Set<string>,
    lang: string,
    refresh: boolean,
    outDir: string,
  ): Promise<BakedPage | null> {
    const url = new URL(path, site).toString();
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return null;
    const html = await res.text();
    const contentHash = hashOf(html).slice(0, 16);

    // Refresh mode: skip jeśli hash się nie zmienił
    if (refresh) {
      const existingFile = join(outDir, 'pages', pathHash(path) + '.json');
      if (existsSync(existingFile)) {
        try {
          const existing = JSON.parse(require('node:fs').readFileSync(existingFile, 'utf-8')) as BakedPage;
          if (existing.contentHash === contentHash) {
            this.log(`  unchanged, skip`);
            return existing;
          }
        } catch {
          // re-bake
        }
      }
    }

    const extracted = extractContent({ url, html });
    const $ = load(html);

    // Alt texts (Ollama vision)
    const altTexts: Record<string, string> = {};
    if (modules.has('alt')) {
      const imgs: Array<{ src: string; existing: string }> = [];
      $('img').each((_, el) => {
        const src = $(el).attr('src');
        const existing = ($(el).attr('alt') ?? '').trim();
        if (src && (existing.length < 4 || /^(image|img|photo|picture)$/i.test(existing))) {
          imgs.push({ src, existing });
        }
      });
      for (const img of imgs.slice(0, 20)) {
        try {
          const absoluteSrc = img.src.startsWith('http') ? img.src : new URL(img.src, url).toString();
          const alt = await this.ollama.describeImage(absoluteSrc);
          if (alt) altTexts[img.src] = alt;
        } catch {
          // skip
        }
      }
    }

    // Title/meta optimization (Ollama text)
    let optimized: BakedPage['optimized'];
    if (modules.has('rewrite')) {
      const currentTitle = extracted.title;
      const currentDesc = extracted.description;
      const targetKw = currentTitle.split(/\s+/).slice(0, 3).join(' ');
      try {
        const newTitle = await this.ollama.generate(
          `Rewrite this HTML title for SEO + AI search. Target keyword: "${targetKw}". Language: ${lang}. Current: "${currentTitle}". Rules: 50-60 chars, keyword first, natural. Output ONLY title text.`,
          { temperature: 0.4, maxTokens: 100 },
        );
        const clean = newTitle.trim().split('\n')[0]?.replace(/^["']+|["']+$/g, '');
        if (clean && clean !== currentTitle && clean.length <= 70) {
          optimized = { title: clean };
        }
      } catch {
        // skip
      }
      if (!currentDesc || currentDesc.length < 100) {
        try {
          const newDesc = await this.ollama.generate(
            `Write meta description for SEO + AI. Target keyword: "${targetKw}". Language: ${lang}. Page topic: ${currentTitle}. Rules: 140-160 chars, include CTA. Output ONLY description.`,
            { temperature: 0.5, maxTokens: 150 },
          );
          const clean = newDesc.trim().split('\n')[0]?.replace(/^["']+|["']+$/g, '');
          if (clean && clean.length >= 100 && clean.length <= 170) {
            optimized = { ...(optimized ?? {}), description: clean };
          }
        } catch {
          // skip
        }
      }
    }

    // Q&A pairs (FAQPage candidates)
    let qa: BakedPage['qa'] = extracted.qa.map((q) => ({ question: q.question, answer: q.answer }));
    if (modules.has('faq') && qa.length < 3) {
      try {
        const generated = await this.ollama.generate(
          `Read this page content and extract 3 likely user questions + short answers based on the content. Language: ${lang}. Page: "${extracted.title}". Content: ${extracted.markdown.slice(0, 2000)}. Output as JSON array: [{"q":"...","a":"..."}]. Output ONLY valid JSON, no preamble.`,
          { temperature: 0.4, maxTokens: 600 },
        );
        const match = generated.match(/\[[\s\S]*\]/);
        if (match) {
          const parsed = JSON.parse(match[0]) as Array<{ q?: string; a?: string }>;
          for (const p of parsed) {
            if (p.q && p.a && qa.length < 5) qa.push({ question: p.q, answer: p.a });
          }
        }
      } catch {
        // skip
      }
    }

    // Schema graph
    let schemaGraph: Record<string, unknown> = {};
    if (modules.has('schema')) {
      const bundle = this.s2m.buildSchema({
        breadcrumbs: this.inferBreadcrumbs(path, site, extracted.title),
        ...(qa.length > 0 ? { faq: qa } : {}),
        speakable: true,
        lang,
      });
      schemaGraph = bundle.graph;
    }

    // Markdown
    const markdown = modules.has('markdown') ? extracted.markdown : '';
    const markdownTokens = Math.ceil(markdown.length / (lang.startsWith('pl') ? 3 : 4));

    return {
      path,
      url,
      title: extracted.title,
      ...(extracted.description ? { description: extracted.description } : {}),
      schemaGraph,
      markdown,
      markdownTokens,
      altTexts,
      ...(optimized ? { optimized } : {}),
      qa,
      contentHash,
      bakedAt: new Date().toISOString(),
    };
  }

  private inferBreadcrumbs(path: string, site: string, lastTitle: string): Array<{ name: string; url: string }> {
    const segments = path.split('/').filter(Boolean);
    const out: Array<{ name: string; url: string }> = [{ name: 'Home', url: site }];
    let acc = '';
    for (let i = 0; i < segments.length; i++) {
      acc += '/' + segments[i];
      const name = i === segments.length - 1 ? lastTitle : capitalize(segments[i]!);
      out.push({ name, url: site.replace(/\/$/, '') + acc });
    }
    return out;
  }
}

function pathHash(path: string): string {
  return createHash('sha256').update(path).digest('hex').slice(0, 16);
}

function hashOf(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/-/g, ' ');
}

export async function bake(s2m: SiteToMcp, cfg: AutopilotConfig, opts: BakeOptions): Promise<BakeManifest> {
  return new BakeOrchestrator(s2m, cfg).bake(opts);
}
