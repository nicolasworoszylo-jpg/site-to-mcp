/**
 * Astro integration.
 *
 * Użycie (astro.config.mjs):
 *
 *     import siteToMcp from '@vidok/site-to-mcp/astro';
 *
 *     export default defineConfig({
 *       integrations: [
 *         siteToMcp({
 *           siteUrl: 'https://example.com',
 *           brand: { name: 'Example', ... },
 *           aiBots: { GPTBot: true, ... },
 *         }),
 *       ],
 *     });
 *
 * Co robi:
 *   - build-time: generuje public/llms.txt, public/robots.txt, public/sitemap.xml,
 *     public/.well-known/agent-card.json, public/skill.md
 *   - dev-time: serwuje te same pliki via Astro dev middleware
 *   - opcjonalnie: dla każdej strony generuje /page.md companion (jak agentmarkup)
 */

import type { SiteToMcpConfig } from '../../types/index.js';
import { createSiteToMcp } from '../../factory.js';

interface AstroIntegration {
  name: string;
  hooks: Record<string, (...args: unknown[]) => void | Promise<void>>;
}

export interface AstroSiteToMcpOptions extends Partial<SiteToMcpConfig> {
  siteUrl: string;
  brand: SiteToMcpConfig['brand'];
  /** Czy generować .md companion dla każdej strony (default true) */
  generateMarkdownCompanions?: boolean;
}

export default function siteToMcp(opts: AstroSiteToMcpOptions): AstroIntegration {
  return {
    name: '@vidok/site-to-mcp',
    hooks: {
      'astro:build:done': async (params: unknown) => {
        const { dir } = params as { dir: URL };
        const s2m = createSiteToMcp(opts);
        const fs = await import('node:fs/promises');
        const path = await import('node:path');
        const outDir = dir.pathname;
        const wellKnown = path.join(outDir, '.well-known');

        await fs.mkdir(wellKnown, { recursive: true });
        await fs.writeFile(path.join(outDir, 'llms.txt'), s2m.generateLlmsTxt());
        await fs.writeFile(path.join(outDir, 'robots.txt'), s2m.generateRobotsTxt());
        await fs.writeFile(path.join(outDir, 'sitemap.xml'), s2m.generateSitemapXml());
        await fs.writeFile(path.join(outDir, 'skill.md'), s2m.generateSkillMd());
        await fs.writeFile(path.join(wellKnown, 'agent-card.json'), s2m.generateAgentCard());
        await fs.writeFile(path.join(wellKnown, 'mcp.json'), JSON.stringify(s2m.createMCPServer().manifest(), null, 2));

        // eslint-disable-next-line no-console
        console.log('[site-to-mcp] Astro: emitted llms.txt, robots.txt, sitemap.xml, agent-card.json, mcp.json, skill.md');

        // .md companions
        if (opts.generateMarkdownCompanions !== false) {
          const htmlFiles = await findHtmlFiles(outDir);
          const { extractContent } = await import('../../core/content-extractor/index.js');
          for (const file of htmlFiles) {
            const html = await fs.readFile(file, 'utf-8');
            const url = `${opts.siteUrl.replace(/\/$/, '')}${file.replace(outDir, '').replace(/index\.html$/, '').replace(/\.html$/, '')}`;
            try {
              const c = extractContent({ url, html });
              const mdPath = file.replace(/\.html$/, '.md');
              await fs.writeFile(mdPath, `# ${c.title}\n\n${c.markdown}`);
            } catch {
              // skip malformed
            }
          }
          // eslint-disable-next-line no-console
          console.log(`[site-to-mcp] Astro: emitted ${htmlFiles.length} .md companions`);
        }
      },
    },
  };
}

async function findHtmlFiles(dir: string): Promise<string[]> {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const out: string[] = [];
  async function walk(d: string): Promise<void> {
    const entries = await fs.readdir(d, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) await walk(full);
      else if (e.name.endsWith('.html')) out.push(full);
    }
  }
  await walk(dir);
  return out;
}
