/**
 * @vidok/site-to-mcp — Public API.
 *
 * Plugin uniwersalny: konwertuje stronę WWW w in-the-wild cytowane przez
 * ChatGPT / Perplexity / Claude / Gemini źródło. Bazuje na 16 zwalidowanych
 * tezach (memory/seo_llm_geo_aeo.md) + framework Osmani'ego "Agentic Engine
 * Optimization" (April 2026).
 *
 * Public entry points:
 *   - createSiteToMcp(config)    — factory + orchestrator
 *   - audit(opts)                — audit jednej strony (6 warstw)
 *   - autofix(opts)              — propose/apply fixes z reportu
 *   - extractContent(opts)       — HTML → markdown + Q&A + stats
 *   - buildSchemaBundle(input)   — pełny @graph JSON-LD
 *   - generate(*)                — llms.txt / robots / sitemap / agent-card itd.
 *   - MCPServer                  — MCP-over-HTTP endpoint
 *   - Monitor                    — citation tracking ChatGPT/Perplexity/Claude/Gemini
 *
 * Adapter exports (per framework):
 *   - @vidok/site-to-mcp/next     — Next.js middleware + plugin
 *   - @vidok/site-to-mcp/express  — Express middleware
 *   - @vidok/site-to-mcp/astro    — Astro integration
 *   - @vidok/site-to-mcp/vanilla  — CDN script + serverless function
 */

export * from './types/index.js';
export { audit, AuditEngine, type AuditOptions } from './core/audit/index.js';
export { autofix, Autofixer, type AutofixOptions } from './core/autofix/index.js';
export { extractContent, ContentExtractor, estimateTokens, type ExtractOptions } from './core/content-extractor/index.js';
export * from './core/schema/index.js';
export * from './core/llms-txt/index.js';
export {
  MCPServer,
  PageIndex,
  MCP_TOOLS,
  detectAiBot,
  shouldServeMarkdown,
  htmlToMarkdownResponse,
  checkRateLimit,
  checkAuth,
  type PageRecord,
  type MCPServerOptions,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type NegotiationContext,
  type MarkdownResponse,
} from './core/mcp-server/index.js';
export { Monitor, monitor, type MonitoringOptions, type EngineName } from './core/monitoring/index.js';
export { computeOverallScore, scoreLetter, type ScoringResult } from './core/scoring/index.js';
export {
  BakedContentReader,
  loadBakedContent,
  type BakedManifest,
  type BakedPage,
} from './core/baked/index.js';
export {
  CitationScorer,
  scoreCitation,
  type CitationScore,
  type AxisScore,
  type Recommendation,
  type ScoreOptions,
} from './core/citation-scorer/index.js';
export { createSiteToMcp, type SiteToMcp } from './factory.js';
