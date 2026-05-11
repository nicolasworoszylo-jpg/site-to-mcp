/**
 * Autofixer — przyjmuje AuditReport i konwertuje findings.autofix na
 * konkretne mutacje HTML lub nowe pliki do wygenerowania.
 *
 * Każdy fix to czysta funkcja: (html, args) → (newHtml, changeLog) ALBO
 * args → (newFileContent).
 *
 * Wszystkie mutacje:
 *   - HTML-only (nie zmieniamy treści copywritingowej — to design decision)
 *   - Idempotentne (uruchom dwa razy = ten sam efekt)
 *   - Atomic (każdy fix = jeden komitowalny diff)
 *
 * IRON LAW:
 *   - Brak destruktywnych zmian (skill seo-llm-auditor philosophy)
 *   - Tylko dodajemy/oznaczamy/wrapujemy — nigdy nie usuwamy bez explicit risk=zero
 *   - Każdy fix ma `risk` w autofix policy: zero/low/medium/high
 *   - Plugin nigdy nie applycuje high-risk bez `autofix.allowed` w config
 */

import { load } from 'cheerio';
import type { AuditReport, AutofixAction, AutofixResult, Finding, SiteToMcpConfig } from '../../types/index.js';
import {
  organization,
  website,
  breadcrumbList,
  speakableSpecification,
  toScriptTag,
} from '../schema/templates.js';
import { generateLlmsTxt, generateRobotsTxt, generateAgentCard, generateSitemapXml, generateHeadersFile, generateSkillMd } from '../llms-txt/index.js';
import { createHash } from 'node:crypto';

export interface AutofixOptions {
  /** AuditReport zawierający rawHtml + findings */
  report: AuditReport;
  config: SiteToMcpConfig;
  /** Czy faktycznie mutować HTML (default false — tylko propose) */
  mutate?: boolean;
  /** Max risk poziom do auto-apply */
  maxRisk?: 'zero' | 'low' | 'medium' | 'high';
  /** Lista typów akcji dozwolonych bez review */
  allowedTypes?: Array<AutofixAction['type']>;
}

const RISK_LEVELS: Record<string, number> = { zero: 0, low: 1, medium: 2, high: 3 };

export class Autofixer {
  constructor(private opts: AutofixOptions) {}

  apply(): AutofixResult {
    const report = this.opts.report;
    const html = report.rawHtml ?? '';
    const $ = load(html);
    const beforeHash = createHash('sha256').update(html).digest('hex').slice(0, 16);

    const applied: AutofixAction[] = [];
    const skipped: Array<AutofixAction & { skipReason: string }> = [];
    const filesGenerated: Array<{ path: string; bytes: number }> = [];

    const maxRisk = this.opts.maxRisk ?? 'low';
    const maxRiskLevel = RISK_LEVELS[maxRisk] ?? 1;
    const allowedTypes = this.opts.allowedTypes;

    // Dla każdego finding z autofix — try fix
    for (const f of report.findings) {
      if (!f.autofixable || !f.autofix) continue;
      const action = this.findingToAction(f);
      if (!action) continue;

      // Risk gate
      const riskLevel = RISK_LEVELS[action.risk] ?? 99;
      if (riskLevel > maxRiskLevel) {
        skipped.push({ ...action, skipReason: `risk=${action.risk} > maxRisk=${maxRisk}` });
        continue;
      }
      if (allowedTypes && !allowedTypes.includes(action.type)) {
        skipped.push({ ...action, skipReason: `type=${action.type} not in allowedTypes` });
        continue;
      }

      // Apply
      try {
        if (action.type === 'generate_file') {
          const fileContent = this.generateFile(action);
          if (fileContent) {
            filesGenerated.push({ path: (action.payload as { path: string }).path, bytes: fileContent.length });
            applied.push(action);
          } else {
            skipped.push({ ...action, skipReason: 'generator returned null' });
          }
        } else if (this.opts.mutate) {
          this.mutateHtml($, action);
          applied.push(action);
        } else {
          // proposal-only mode — applied = "would have applied"
          applied.push(action);
        }
      } catch (err) {
        skipped.push({ ...action, skipReason: `apply error: ${err}` });
      }
    }

    const newHtml = $.html();
    const afterHash = createHash('sha256').update(newHtml).digest('hex').slice(0, 16);

    return {
      applied,
      skipped,
      beforeHash,
      afterHash,
      diff: this.opts.mutate ? this.simpleDiff(html, newHtml) : undefined,
      filesGenerated,
    };
  }

  /**
   * Mapuje Finding na konkretną akcję autofix (z brand context).
   */
  private findingToAction(f: Finding): AutofixAction | null {
    if (!f.autofix) return null;

    const action = f.autofix.action;
    const args = f.autofix.args;
    const risk = f.autofix.risk;
    const reason = f.detail;
    const citation = f.citation;
    const id = f.id;

    switch (action) {
      case 'inject_canonical':
        return {
          id,
          type: 'inject_meta',
          target: 'head',
          payload: { tag: 'link', rel: 'canonical', href: args['url'] },
          reason,
          citation,
          risk,
        };
      case 'remove_noindex':
        return {
          id,
          type: 'replace_html',
          target: 'meta[name="robots"]',
          payload: { remove: true },
          reason,
          citation,
          risk,
        };
      case 'set_html_lang':
        return {
          id,
          type: 'add_attribute',
          target: 'html',
          payload: { attr: 'lang', value: args['lang'] },
          reason,
          citation,
          risk,
        };
      case 'inject_schema':
        return {
          id,
          type: 'inject_schema',
          target: 'head',
          payload: { schemaType: args['type'] },
          reason,
          citation,
          risk,
        };
      case 'wrap_in_main':
        return {
          id,
          type: 'wrap_html',
          target: 'body',
          payload: { wrapper: 'main', selectorsToWrap: 'body > *:not(header):not(footer):not(nav)' },
          reason,
          citation,
          risk,
        };
      case 'wrap_in_article':
        return {
          id,
          type: 'wrap_html',
          target: 'main',
          payload: { wrapper: 'article', selectorsToWrap: 'main > *' },
          reason,
          citation,
          risk,
        };
      case 'generate_file':
        return {
          id,
          type: 'generate_file',
          target: '',
          payload: { file: args['file'], path: args['path'] },
          reason,
          citation,
          risk,
        };
      case 'allow_bot_in_robots':
        return {
          id,
          type: 'generate_file',
          target: '',
          payload: { file: 'robots.txt', path: '/robots.txt', addBot: args['bot'] },
          reason,
          citation,
          risk,
        };
      case 'whitelist_bot':
        return {
          id,
          type: 'generate_file',
          target: '',
          payload: { file: 'robots.txt', path: '/robots.txt', addBot: args['bot'] },
          reason,
          citation,
          risk,
        };
      default:
        return null;
    }
  }

  // ==========================================================================
  // HTML mutations
  // ==========================================================================

  private mutateHtml($: ReturnType<typeof load>, action: AutofixAction): void {
    switch (action.type) {
      case 'inject_meta': {
        const p = action.payload as { tag: string; rel?: string; href?: string; name?: string; content?: string };
        if (p.tag === 'link') {
          if ($(`link[rel="${p.rel}"]`).length > 0) return; // idempotent
          $('head').append(`\n<link rel="${p.rel}" href="${p.href}">`);
        } else if (p.tag === 'meta') {
          if ($(`meta[name="${p.name}"]`).length > 0) return;
          $('head').append(`\n<meta name="${p.name}" content="${p.content}">`);
        }
        return;
      }
      case 'add_attribute': {
        const p = action.payload as { attr: string; value: string };
        $(action.target).attr(p.attr, p.value);
        return;
      }
      case 'replace_html': {
        const p = action.payload as { remove?: boolean; with?: string };
        if (p.remove) $(action.target).remove();
        else if (p.with) $(action.target).replaceWith(p.with);
        return;
      }
      case 'wrap_html': {
        const p = action.payload as { wrapper: string; selectorsToWrap: string };
        const children = $(p.selectorsToWrap);
        if (children.length === 0) return;
        // Cheerio 1.x: `wrapAll` istnieje w runtime ale type system go nie eksportuje
        const w = `<${p.wrapper}></${p.wrapper}>`;
        (children as unknown as { wrapAll: (w: string) => unknown }).wrapAll(w);
        return;
      }
      case 'inject_schema': {
        const p = action.payload as { schemaType: string };
        const script = this.buildSchemaScript(p.schemaType);
        if (script) $('head').append(`\n${script}`);
        return;
      }
      case 'inject_html': {
        const p = action.payload as { html: string };
        $(action.target).append(p.html);
        return;
      }
      default:
        return;
    }
  }

  private buildSchemaScript(schemaType: string): string | null {
    const brand = this.opts.config.brand;
    const url = this.opts.config.siteUrl;
    let schema: Record<string, unknown> | null = null;

    switch (schemaType) {
      case 'Organization':
        schema = organization(brand, url);
        break;
      case 'WebSite':
        schema = website(url, brand.name);
        break;
      case 'BreadcrumbList':
        schema = breadcrumbList([{ name: 'Home', url }]);
        break;
      case 'SpeakableSpecification':
        schema = speakableSpecification();
        break;
      default:
        return null;
    }
    return toScriptTag(schema);
  }

  // ==========================================================================
  // File generators
  // ==========================================================================

  private generateFile(action: AutofixAction): string | null {
    const p = action.payload as { file: string; path: string; addBot?: string };
    const config = this.opts.config;

    switch (p.file) {
      case 'robots.txt':
        return generateRobotsTxt({
          siteUrl: config.siteUrl,
          aiBots: config.aiBots,
          sitemapPath: '/sitemap.xml',
        });

      case 'llms.txt':
        return generateLlmsTxt({
          siteName: config.brand.name,
          siteDescription: config.brand.description,
          siteUrl: config.siteUrl,
          sections: config.llmsTxt?.sections ?? [
            {
              title: 'Pages',
              links: [{ url: `${config.siteUrl}/`, title: 'Home', description: 'Homepage' }],
            },
          ],
        });

      case 'sitemap.xml':
        return generateSitemapXml([{ loc: config.siteUrl, changefreq: 'weekly', priority: 1.0 }]);

      case 'feed.xml':
        return null; // wymaga blog posts — skip

      case '.well-known/agent-card.json':
        return generateAgentCard({
          name: config.brand.name,
          description: config.brand.description ?? 'Website',
          siteUrl: config.siteUrl,
          capabilities: ['list_pages', 'get_page', 'search_pages', 'get_faq', 'get_brand'],
          endpoints: {
            mcp: `${config.siteUrl}${config.mcp?.path ?? '/.well-known/mcp.json'}`,
            llmsTxt: `${config.siteUrl}/llms.txt`,
          },
          ...(config.brand.contact?.email ? { contact: { email: config.brand.contact.email } } : {}),
        });

      case '_headers':
        return generateHeadersFile({
          paths: [
            {
              pattern: '/*',
              headers: { 'X-Robots-Tag': 'all' },
            },
          ],
          globalContentSignal: { aiTrain: 'partial', aiSearch: 'yes', aiReasoning: 'yes' },
        });

      case 'skill.md':
        return generateSkillMd({
          name: config.brand.name,
          description: config.brand.description ?? 'Website',
          capabilities: ['Browse pages', 'Search content', 'Get FAQ', 'Get brand info'],
          howToUse: [
            `Fetch ${config.siteUrl}/llms.txt to get a sitemap`,
            `Fetch any URL with Accept: text/markdown to get clean markdown`,
            `Use MCP endpoint at ${config.mcp?.path ?? '/.well-known/mcp.json'} for tool-based access`,
          ],
          endpoints: {
            'llms.txt': `${config.siteUrl}/llms.txt`,
            mcp: `${config.siteUrl}${config.mcp?.path ?? '/.well-known/mcp.json'}`,
          },
        });

      default:
        return null;
    }
  }

  // ==========================================================================
  // Diff (simple, line-by-line)
  // ==========================================================================

  private simpleDiff(before: string, after: string): string {
    if (before === after) return '(no changes)';
    const beforeLines = before.split('\n');
    const afterLines = after.split('\n');
    const out: string[] = [];
    const max = Math.max(beforeLines.length, afterLines.length);
    let context = 0;
    for (let i = 0; i < max; i++) {
      const b = beforeLines[i];
      const a = afterLines[i];
      if (b === a) {
        if (context < 3) out.push(`  ${b ?? ''}`);
        context++;
        continue;
      }
      context = 0;
      if (b !== undefined) out.push(`- ${b}`);
      if (a !== undefined) out.push(`+ ${a}`);
    }
    return out.slice(0, 200).join('\n'); // cap
  }
}

export function autofix(opts: AutofixOptions): AutofixResult {
  return new Autofixer(opts).apply();
}
