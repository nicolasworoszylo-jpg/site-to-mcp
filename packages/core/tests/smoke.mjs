#!/usr/bin/env node
/**
 * Smoke test — sprawdza że wszystkie public exports z dist/ działają.
 *
 * Run:
 *   npm run build
 *   node tests/smoke.mjs
 *
 * Nie wymaga sieci — używa fixture HTML.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const FAILURES = [];
function assert(cond, msg) {
  if (!cond) {
    FAILURES.push(msg);
    console.error('  ✗', msg);
  } else {
    console.log('  ✓', msg);
  }
}

async function main() {
  console.log('site-to-mcp smoke test\n');

  // Import dist
  const mod = await import('../dist/index.js');
  const {
    createSiteToMcp,
    audit,
    autofix,
    extractContent,
    estimateTokens,
    buildSchemaBundle,
    generateLlmsTxt,
    generateRobotsTxt,
    generateSitemapXml,
    generateAgentCard,
    MCPServer,
    PageIndex,
    detectAiBot,
    shouldServeMarkdown,
    htmlToMarkdownResponse,
    computeOverallScore,
    scoreLetter,
  } = mod;

  // === Test 1: factory ===
  console.log('\n[1] Factory');
  const s2m = createSiteToMcp({
    siteUrl: 'https://example.com',
    brand: {
      name: 'Example Inc',
      description: 'Best widgets',
      sameAs: ['https://linkedin.com/company/example'],
      primaryAuthor: {
        name: 'Jane Doe',
        jobTitle: 'CTO',
        sameAs: ['https://linkedin.com/in/janedoe'],
      },
    },
  });
  assert(typeof s2m.audit === 'function', 'factory returns object with .audit');
  assert(typeof s2m.generateLlmsTxt === 'function', 'factory returns object with .generateLlmsTxt');

  // === Test 2: content extraction ===
  console.log('\n[2] Content extraction');
  const html = await readFile(join(__dirname, 'fixtures/sample-blog-post.html'), 'utf-8');
  const content = extractContent({ url: 'https://example.com/blog/jak-pisac', html });
  assert(content.title.includes('Jak pisać'), 'extracts title');
  assert(content.markdown.length > 500, `markdown length > 500 (got ${content.markdown.length})`);
  assert(content.qa.length >= 2, `extracts Q&A pairs (got ${content.qa.length})`);
  assert(content.metrics.wordCount > 100, `word count > 100 (got ${content.metrics.wordCount})`);
  assert(content.metrics.statsCount > 0, `extracts stats (got ${content.metrics.statsCount})`);
  assert(content.quotes.length > 0, `extracts quotes (got ${content.quotes.length})`);
  assert(content.headings.some((h) => h.isQuestion), 'detects question headings');

  // === Test 3: token estimation ===
  console.log('\n[3] Token estimation');
  const tokens = estimateTokens('Lorem ipsum dolor sit amet.', 'en');
  assert(tokens > 0 && tokens < 20, `estimateTokens returns reasonable value (got ${tokens})`);

  // === Test 4: schema builder ===
  console.log('\n[4] Schema builder');
  const bundle = buildSchemaBundle({
    siteUrl: 'https://example.com',
    brand: { name: 'Example Inc' },
    page: {
      type: 'BlogPosting',
      url: 'https://example.com/blog/foo',
      headline: 'Test',
      author: { name: 'Jane Doe' },
      datePublished: '2026-05-01',
    },
    faq: [{ question: 'Q1?', answer: 'A1.' }],
    breadcrumbs: [{ name: 'Home', url: 'https://example.com' }],
  });
  assert(bundle.types.includes('Organization'), 'bundle has Organization');
  assert(bundle.types.includes('WebSite'), 'bundle has WebSite');
  assert(bundle.types.includes('BlogPosting'), 'bundle has BlogPosting');
  assert(bundle.types.includes('FAQPage'), 'bundle has FAQPage');
  assert(bundle.types.includes('BreadcrumbList'), 'bundle has BreadcrumbList');
  assert(bundle.scriptTag.includes('<script'), 'scriptTag is valid');
  assert(bundle.scriptTag.includes('application/ld+json'), 'scriptTag has ld+json mime');

  // === Test 5: llms.txt ===
  console.log('\n[5] llms.txt');
  const llms = generateLlmsTxt({
    siteName: 'Example',
    siteDescription: 'Best widgets',
    siteUrl: 'https://example.com',
    sections: [
      {
        title: 'Pages',
        links: [{ url: 'https://example.com/', title: 'Home' }],
      },
    ],
  });
  assert(llms.startsWith('# Example'), 'llms.txt starts with # SiteName');
  assert(llms.includes('## Pages'), 'llms.txt has Pages section');
  assert(llms.includes('[Home]'), 'llms.txt has Home link');

  // === Test 6: robots.txt ===
  console.log('\n[6] robots.txt');
  const robots = generateRobotsTxt({
    siteUrl: 'https://example.com',
    aiBots: { GPTBot: false, PerplexityBot: true, ClaudeBot: false, 'Google-Extended': false, AppleBot: true, Bingbot: true, CCBot: false, YouBot: true, Bytespider: false },
  });
  assert(robots.includes('User-agent: GPTBot'), 'robots has GPTBot section');
  assert(robots.includes('User-agent: PerplexityBot'), 'robots has PerplexityBot section');
  assert(robots.includes('Sitemap:'), 'robots has Sitemap line');

  // === Test 7: sitemap ===
  console.log('\n[7] sitemap.xml');
  const sitemap = generateSitemapXml([
    { loc: 'https://example.com/', changefreq: 'weekly', priority: 1.0 },
    { loc: 'https://example.com/blog/foo', lastmod: '2026-05-01' },
  ]);
  assert(sitemap.startsWith('<?xml'), 'sitemap is valid XML');
  assert(sitemap.includes('<urlset'), 'sitemap has urlset');
  assert(sitemap.includes('<loc>https://example.com/</loc>'), 'sitemap has URL');

  // === Test 8: agent card ===
  console.log('\n[8] agent-card.json');
  const card = generateAgentCard({
    name: 'Example',
    description: 'Best widgets',
    siteUrl: 'https://example.com',
    capabilities: ['list_pages'],
  });
  const cardObj = JSON.parse(card);
  assert(cardObj.schemaVersion?.startsWith('a2a/'), 'agent-card has schemaVersion');
  assert(cardObj.name === 'Example', 'agent-card has name');
  assert(Array.isArray(cardObj.capabilities), 'agent-card has capabilities');

  // === Test 9: MCP ===
  console.log('\n[9] MCP');
  const pageIndex = new PageIndex();
  pageIndex.add({
    url: 'https://example.com/blog/foo',
    path: '/blog/foo',
    title: 'Foo',
    tokens: 1000,
    preview: { headings: [{ level: 1, text: 'Foo' }] },
  });
  assert(pageIndex.size() === 1, 'page index stores page');
  assert(pageIndex.get('/blog/foo')?.title === 'Foo', 'page index retrieves');
  assert(pageIndex.search('Foo').length === 1, 'page index search works');

  const mcp = new MCPServer({
    config: s2m.config,
    pageIndex,
  });
  const manifest = mcp.manifest();
  assert(manifest.tools.length === 12, `MCP manifest has 12 tools (got ${manifest.tools.length})`);
  assert(manifest.tools.some((t) => t.name === 'list_pages'), 'MCP has list_pages tool');
  assert(manifest.tools.some((t) => t.name === 'get_pricing'), 'MCP has get_pricing tool (v1.2)');
  assert(manifest.tools.some((t) => t.name === 'get_team'), 'MCP has get_team tool (v1.2)');

  const initRes = await mcp.handle({ jsonrpc: '2.0', id: 1, method: 'initialize' });
  assert(initRes.result, 'MCP initialize returns result');

  const listRes = await mcp.handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  assert(listRes.result?.tools?.length === 12, 'MCP tools/list returns 12 tools');

  // === Test 10: content negotiation ===
  console.log('\n[10] Content negotiation');
  const { isBot: isGptBot } = detectAiBot('Mozilla/5.0 ... compatible; GPTBot/1.0; +https://openai.com/gptbot');
  assert(isGptBot, 'detects GPTBot UA');
  const { isBot: isClaudeBot } = detectAiBot('Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)');
  assert(isClaudeBot, 'detects ClaudeBot UA');
  const { isBot: isBrowser } = detectAiBot('Mozilla/5.0 (Macintosh) Chrome/120');
  assert(!isBrowser, 'does not detect browser as bot');

  assert(shouldServeMarkdown({ pathname: '/blog/foo.md' }), 'shouldServeMarkdown: .md suffix');
  assert(shouldServeMarkdown({ pathname: '/blog/foo', accept: 'text/markdown' }), 'shouldServeMarkdown: Accept');
  assert(shouldServeMarkdown({ pathname: '/blog/foo', userAgent: 'GPTBot/1.0' }), 'shouldServeMarkdown: bot UA');
  assert(!shouldServeMarkdown({ pathname: '/blog/foo', accept: 'text/html', userAgent: 'Chrome' }), 'shouldServeMarkdown: false for browser');

  const md = htmlToMarkdownResponse(html, 'https://example.com/blog/jak-pisac', 'pl-PL');
  assert(md.body.length > 100, 'htmlToMarkdownResponse produces markdown');
  assert(md.headers['X-AI-Tokens'], 'response has X-AI-Tokens header');
  assert(md.headers['Content-Type']?.includes('markdown'), 'response has markdown Content-Type');

  // === Test 11: audit (offline mode z rawHtml) ===
  console.log('\n[11] Audit (offline)');
  const report = await audit({
    url: 'https://example.com/blog/jak-pisac',
    config: s2m.config,
    testAiBots: false,
    rawHtml: html,
  });
  assert(report.findings.length > 10, `audit produces findings (got ${report.findings.length})`);
  assert(typeof report.scores.overall === 'number', 'audit has overall score');
  assert(report.scores.overall >= 0 && report.scores.overall <= 100, 'score in 0-100');

  const score = computeOverallScore(report);
  assert(['A+', 'A', 'B', 'C', 'D', 'F'].includes(score.letter), `score letter valid (got ${score.letter})`);
  assert(['ready', 'needs_work', 'not_ready'].includes(score.category), `score category valid (got ${score.category})`);

  // === Test 12: autofix ===
  console.log('\n[12] Autofix');
  const fixResult = autofix({ report, config: s2m.config, mutate: false, maxRisk: 'low' });
  assert(Array.isArray(fixResult.applied), 'autofix.applied is array');
  assert(Array.isArray(fixResult.skipped), 'autofix.skipped is array');

  // === Test 13: scoring ===
  console.log('\n[13] Scoring');
  assert(scoreLetter(95) === 'A+', 'scoreLetter 95 → A+');
  assert(scoreLetter(85) === 'A', 'scoreLetter 85 → A');
  assert(scoreLetter(70) === 'B', 'scoreLetter 70 → B');
  assert(scoreLetter(55) === 'C', 'scoreLetter 55 → C');
  assert(scoreLetter(40) === 'D', 'scoreLetter 40 → D');
  assert(scoreLetter(0) === 'F', 'scoreLetter 0 → F');

  // === Final ===
  console.log('\n══════════════════════════════════════════');
  if (FAILURES.length === 0) {
    console.log('✓ All checks passed');
    process.exit(0);
  } else {
    console.log(`✗ ${FAILURES.length} failures:`);
    for (const f of FAILURES) console.log('  -', f);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('SMOKE TEST CRASHED:', err);
  process.exit(2);
});
