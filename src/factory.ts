/**
 * Factory: tworzy "instance" SiteToMcp z całą orkiestracją.
 *
 * Use case: jedna konfiguracja, wiele operacji.
 *
 *   const s2m = createSiteToMcp({
 *     siteUrl: 'https://example.com',
 *     brand: { name: 'Example', ... },
 *     aiBots: { GPTBot: true, ... },
 *   });
 *
 *   const report = await s2m.audit('https://example.com/blog/foo');
 *   const fix = s2m.proposeFixes(report);
 *   const llmsTxt = s2m.generateLlmsTxt(pages);
 *   const mcp = s2m.createMCPServer();
 *   const monitor = s2m.createMonitor();
 */

import type { SiteToMcpConfig, AuditReport, AutofixResult, ExtractedContent } from './types/index.js';
import { audit } from './core/audit/index.js';
import { autofix } from './core/autofix/index.js';
import { extractContent } from './core/content-extractor/index.js';
import { buildSchemaBundle, type SchemaBundleInput, type SchemaBundleOutput } from './core/schema/index.js';
import {
  generateLlmsTxt,
  generateLlmsFullTxt,
  generateRobotsTxt,
  generateSitemapXml,
  generateRss,
  generateAgentCard,
  generateHeadersFile,
  generateSkillMd,
  generateAgentsMd,
  generateAiTxt,
  type LlmsTxtInput,
  type LlmsFullInput,
  type RobotsTxtInput,
  type SitemapEntry,
  type RssFeedInput,
  type AgentCardInput,
  type AiTxtInput,
} from './core/llms-txt/index.js';
import { MCPServer, PageIndex } from './core/mcp-server/index.js';
import { Monitor } from './core/monitoring/index.js';

const DEFAULT_AI_BOTS: SiteToMcpConfig['aiBots'] = {
  // training - default disallow
  GPTBot: false,
  ClaudeBot: false,
  'Google-Extended': false,
  'AppleBot-Extended': false,
  CCBot: false,
  Bytespider: false,
  'Meta-ExternalAgent': false,
  // search/citation - default allow (to są bots które dają cytowania)
  'OAI-SearchBot': true,
  'ChatGPT-User': true,
  PerplexityBot: true,
  'Claude-SearchBot': true,
  'Claude-User': true,
  Bingbot: true,
  // mixed
  AppleBot: true,
  YouBot: true,
};

export class SiteToMcp {
  readonly config: SiteToMcpConfig;
  readonly pageIndex: PageIndex;

  constructor(config: Partial<SiteToMcpConfig> & Pick<SiteToMcpConfig, 'siteUrl' | 'brand'>) {
    this.config = {
      siteUrl: config.siteUrl,
      brand: config.brand,
      aiBots: { ...DEFAULT_AI_BOTS, ...config.aiBots },
      mcp: {
        enabled: true,
        path: '/.well-known/mcp.json',
        rateLimitPerMin: 60,
        requireAuth: false,
        ...config.mcp,
      },
      llmsTxt: {
        enabled: true,
        path: '/llms.txt',
        fullPath: '/llms-full.txt',
        ...config.llmsTxt,
      },
      ...(config.monitoring ? { monitoring: config.monitoring } : {}),
      autofix: {
        mutate: false,
        allowed: ['inject_meta', 'inject_schema', 'add_attribute', 'generate_file'],
        maxRisk: 'low',
        ...config.autofix,
      },
    };
    this.pageIndex = new PageIndex();
  }

  /**
   * Audit jednej strony.
   */
  async audit(url: string, opts?: { pagespeedApiKey?: string; testAiBots?: boolean; rawHtml?: string }): Promise<AuditReport> {
    return audit({
      url,
      config: this.config,
      ...(opts?.pagespeedApiKey !== undefined ? { pagespeedApiKey: opts.pagespeedApiKey } : {}),
      ...(opts?.testAiBots !== undefined ? { testAiBots: opts.testAiBots } : {}),
      ...(opts?.rawHtml !== undefined ? { rawHtml: opts.rawHtml } : {}),
    });
  }

  /**
   * Propose fixes (nie mutuje plików).
   */
  proposeFixes(report: AuditReport): AutofixResult {
    return autofix({ report, config: this.config, mutate: false, maxRisk: this.config.autofix?.maxRisk ?? 'low' });
  }

  /**
   * Apply fixes (mutuje HTML in-place + zwraca pliki do wygenerowania).
   */
  applyFixes(report: AuditReport): AutofixResult {
    return autofix({ report, config: this.config, mutate: true, maxRisk: this.config.autofix?.maxRisk ?? 'low' });
  }

  /**
   * Ekstrakcja contentu (HTML → MD + Q&A + stats).
   */
  extract(url: string, html: string): ExtractedContent {
    return extractContent({ url, html });
  }

  /**
   * Build schema bundle (JSON-LD @graph) dla strony.
   */
  buildSchema(input: Omit<SchemaBundleInput, 'siteUrl' | 'brand'>): SchemaBundleOutput {
    return buildSchemaBundle({
      ...input,
      siteUrl: this.config.siteUrl,
      brand: this.config.brand,
    });
  }

  // ==========================================================================
  // AI file generators
  // ==========================================================================

  generateLlmsTxt(input?: Partial<LlmsTxtInput>): string {
    const pages = this.pageIndex.list();
    const sections = input?.sections ?? [
      {
        title: 'Pages',
        links: pages.slice(0, 50).map((p) => ({
          url: p.url,
          title: p.title,
          ...(p.description ? { description: p.description } : {}),
        })),
      },
    ];
    return generateLlmsTxt({
      siteName: this.config.brand.name,
      siteDescription: this.config.brand.description,
      siteUrl: this.config.siteUrl,
      sections,
      ...input,
    });
  }

  generateRobotsTxt(input?: Partial<RobotsTxtInput>): string {
    return generateRobotsTxt({
      siteUrl: this.config.siteUrl,
      aiBots: this.config.aiBots,
      sitemapPath: '/sitemap.xml',
      ...input,
    });
  }

  generateSitemapXml(entries?: SitemapEntry[]): string {
    const items =
      entries ??
      this.pageIndex.list().map(
        (p): SitemapEntry => ({
          loc: p.url,
          ...(p.lastModified ? { lastmod: p.lastModified } : {}),
          changefreq: 'weekly',
          priority: p.path === '/' ? 1.0 : 0.7,
        }),
      );
    return generateSitemapXml(items);
  }

  generateRss(input: RssFeedInput): string {
    return generateRss(input);
  }

  /**
   * Pełna treść strony w jednym pliku dla AI agentów.
   * Cap default 28k tokens (poniżej 30k Osmani limit).
   */
  generateLlmsFullTxt(input?: Partial<LlmsFullInput>): { content: string; truncated: boolean; totalTokens: number } {
    const pages = this.pageIndex.list().map((p) => ({
      url: p.url,
      title: p.title,
      markdown: p.full?.markdown ?? p.preview.firstParagraph ?? '',
      tokens: p.tokens,
    }));
    return generateLlmsFullTxt({
      siteName: this.config.brand.name,
      pages,
      maxTokens: 28000,
      ...input,
    });
  }

  /**
   * Eksperymentalny ai.txt z polityką użycia.
   * Adopcja niska (~0%), ale 2 KB ROI — generujemy bo nie szkodzi.
   */
  generateAiTxt(input?: Partial<AiTxtInput>): string {
    return generateAiTxt({
      siteUrl: this.config.siteUrl,
      policy: 'require_attribution',
      ...(this.config.brand.contact?.email ? { contact: this.config.brand.contact.email } : {}),
      ...input,
    });
  }

  generateAgentCard(input?: Partial<AgentCardInput>): string {
    return generateAgentCard({
      name: this.config.brand.name,
      description: this.config.brand.description ?? '',
      siteUrl: this.config.siteUrl,
      capabilities: ['list_pages', 'get_page', 'search_pages', 'get_faq', 'get_brand'],
      endpoints: {
        mcp: `${this.config.siteUrl}${this.config.mcp?.path}`,
        llmsTxt: `${this.config.siteUrl}${this.config.llmsTxt?.path}`,
      },
      ...(this.config.brand.contact?.email ? { contact: { email: this.config.brand.contact.email } } : {}),
      ...input,
    });
  }

  generateHeadersFile(allowTraining = false): string {
    return generateHeadersFile({
      paths: [{ pattern: '/*', headers: { 'X-Robots-Tag': 'all' } }],
      globalContentSignal: {
        aiTrain: allowTraining ? 'yes' : 'no',
        aiSearch: 'yes',
        aiReasoning: 'yes',
      },
    });
  }

  generateSkillMd(): string {
    return generateSkillMd({
      name: this.config.brand.name,
      description: this.config.brand.description ?? '',
      capabilities: ['Browse pages', 'Search content', 'Get FAQ', 'Get brand info'],
      howToUse: [
        `Fetch ${this.config.siteUrl}/llms.txt for sitemap`,
        `Fetch any URL with 'Accept: text/markdown' header for markdown`,
        `Use MCP at ${this.config.siteUrl}${this.config.mcp?.path}`,
      ],
      endpoints: {
        'llms.txt': `${this.config.siteUrl}/llms.txt`,
        mcp: `${this.config.siteUrl}${this.config.mcp?.path}`,
      },
    });
  }

  generateAgentsMd(projectName?: string): string {
    return generateAgentsMd({
      projectName: projectName ?? this.config.brand.name,
      nonInferable: {},
    });
  }

  // ==========================================================================
  // MCP & Monitoring
  // ==========================================================================

  createMCPServer(): MCPServer {
    return new MCPServer({ config: this.config, pageIndex: this.pageIndex });
  }

  createMonitor(history?: import('./types/index.js').CitationCheck[]): Monitor {
    return new Monitor({ config: this.config, ...(history ? { history } : {}) });
  }
}

export function createSiteToMcp(config: Partial<SiteToMcpConfig> & Pick<SiteToMcpConfig, 'siteUrl' | 'brand'>): SiteToMcp {
  return new SiteToMcp(config);
}
