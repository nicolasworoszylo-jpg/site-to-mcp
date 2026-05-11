#!/usr/bin/env node
/**
 * site-to-mcp CLI.
 *
 * Komendy:
 *   init                       — interactive setup (tworzy s2m.config.json)
 *   audit <url>                — audit pojedynczej strony, output A-F score + findings
 *   audit-crawl <url>          — crawl + audit (max 50 stron)
 *   fix <url> [--apply]        — propose lub apply autofix
 *   generate <file> [--out]    — gen llms.txt | robots.txt | sitemap.xml | agent-card.json | skill.md | AGENTS.md
 *   serve [--port 3030]        — local dev server z wszystkimi endpoints (MCP + llms.txt etc.)
 *   monitor                    — run monitoring (wymaga config.monitoring + API keys)
 *   report <history.json>      — wygeneruj markdown report z historii
 *
 * Output: czytelny dla człowieka + JSON na --json flag (dla CI).
 *
 * Exit codes:
 *   0   — success
 *   1   — generic error
 *   2   — audit score < --threshold (CI gate)
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { createRequire } from 'node:module';
import { createSiteToMcp } from '../factory.js';
import { verifyDeploy } from '../core/verify/index.js';

const require = createRequire(import.meta.url);
const PKG = require('../../package.json') as { version: string };
const VERSION = PKG.version;
import { computeOverallScore } from '../core/scoring/index.js';
import type { SiteToMcpConfig } from '../types/index.js';

const COLORS = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

function color(c: keyof typeof COLORS, text: string): string {
  return `${COLORS[c]}${text}${COLORS.reset}`;
}

function parseArgs(argv: string[]): { cmd: string; positional: string[]; flags: Record<string, string | boolean> } {
  const [, , cmd = 'help', ...rest] = argv;
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (!arg) continue;
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      if (eq !== -1) {
        flags[arg.slice(2, eq)] = arg.slice(eq + 1);
      } else {
        const next = rest[i + 1];
        if (next && !next.startsWith('--')) {
          flags[arg.slice(2)] = next;
          i++;
        } else {
          flags[arg.slice(2)] = true;
        }
      }
    } else {
      positional.push(arg);
    }
  }
  return { cmd, positional, flags };
}

async function loadConfig(path?: string): Promise<SiteToMcpConfig | null> {
  const tryPaths = [path, 's2m.config.json', 's2m.config.js'].filter(Boolean) as string[];
  for (const p of tryPaths) {
    const abs = resolve(p);
    if (existsSync(abs)) {
      if (abs.endsWith('.json')) {
        return JSON.parse(await readFile(abs, 'utf-8')) as SiteToMcpConfig;
      }
      if (abs.endsWith('.js')) {
        const mod = await import(abs);
        return (mod.default ?? mod) as SiteToMcpConfig;
      }
    }
  }
  return null;
}

async function ensureConfig(configPath?: string): Promise<SiteToMcpConfig> {
  const cfg = await loadConfig(configPath);
  if (!cfg) {
    console.error(color('red', '✗ Brak config. Uruchom: site-to-mcp init'));
    process.exit(1);
  }
  return cfg;
}

// ============================================================================
// COMMANDS
// ============================================================================

async function cmdInit(): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string, def?: string) => rl.question(`${q}${def ? ` [${def}]` : ''}: `).then((a) => a.trim() || def || '');

  console.log(color('bold', 'site-to-mcp init') + '\n');
  console.log('Tworzymy konfigurację s2m.config.json.\n');

  const siteUrl = await ask('Site URL', 'https://example.com');
  const brandName = await ask('Brand name');
  const brandDescription = await ask('Brand description (one line)');
  const brandEmail = await ask('Contact email');
  const linkedIn = await ask('LinkedIn URL (sameAs)');

  const allowTraining = (await ask('Allow training crawlers (GPTBot, ClaudeBot)? y/n', 'n')).toLowerCase() === 'y';

  rl.close();

  const config: SiteToMcpConfig = {
    siteUrl,
    brand: {
      name: brandName,
      description: brandDescription,
      sameAs: linkedIn ? [linkedIn] : [],
      contact: brandEmail ? { email: brandEmail } : {},
    },
    aiBots: {
      // training
      GPTBot: allowTraining,
      ClaudeBot: allowTraining,
      'Google-Extended': allowTraining,
      'AppleBot-Extended': false,
      CCBot: false,
      Bytespider: false,
      'Meta-ExternalAgent': false,
      // search/citation
      'OAI-SearchBot': true,
      'ChatGPT-User': true,
      PerplexityBot: true,
      'Claude-SearchBot': true,
      'Claude-User': true,
      Bingbot: true,
      // mixed
      AppleBot: true,
      YouBot: true,
    },
    mcp: { enabled: true, path: '/.well-known/mcp.json', rateLimitPerMin: 60, requireAuth: false },
    llmsTxt: { enabled: true, path: '/llms.txt', fullPath: '/llms-full.txt' },
    autofix: { mutate: false, allowed: ['inject_meta', 'inject_schema', 'add_attribute', 'generate_file'], maxRisk: 'low' },
  };

  await writeFile('s2m.config.json', JSON.stringify(config, null, 2));
  console.log(color('green', '✓ Utworzony s2m.config.json'));
  console.log();
  console.log('Następne kroki:');
  console.log('  1. ' + color('cyan', 'site-to-mcp audit ' + siteUrl));
  console.log('  2. ' + color('cyan', 'site-to-mcp generate llms.txt --out public/llms.txt'));
  console.log('  3. ' + color('cyan', 'site-to-mcp serve --port 3030') + '  (local dev z wszystkimi endpoints)');
}

async function cmdAudit(url: string, flags: Record<string, string | boolean>): Promise<number> {
  const cfg = await ensureConfig(flags['config'] as string | undefined);
  const s2m = createSiteToMcp(cfg);

  console.log(`${color('bold', '▸')} Audit ${color('cyan', url)}\n`);
  const report = await s2m.audit(url, {
    pagespeedApiKey: typeof flags['pagespeed-key'] === 'string' ? flags['pagespeed-key'] : undefined,
  });

  const score = computeOverallScore(report);

  if (flags['json']) {
    console.log(JSON.stringify({ report, score }, null, 2));
  } else {
    printAuditReport(report, score);
  }

  const threshold = Number(flags['threshold'] ?? 0);
  if (threshold > 0 && score.overall < threshold) {
    console.error(color('red', `✗ Score ${score.overall} < threshold ${threshold}`));
    return 2;
  }
  return 0;
}

function printAuditReport(report: ReturnType<typeof JSON.parse>, score: ReturnType<typeof computeOverallScore>): void {
  const grade = score.letter;
  const color_ = grade === 'A+' || grade === 'A' ? 'green' : grade === 'B' ? 'cyan' : grade === 'C' ? 'yellow' : 'red';
  console.log(`  Score: ${color(color_ as keyof typeof COLORS, String(score.overall))}/100  Grade: ${color(color_ as keyof typeof COLORS, grade)}  Category: ${color('bold', score.category)}\n`);

  console.log(`  ${color('dim', 'Per layer:')}`);
  for (const [layer, s] of Object.entries(report.scores)) {
    if (layer === 'overall') continue;
    const bar = '█'.repeat(Math.floor(Number(s) / 5)).padEnd(20, '·');
    console.log(`    ${layer.padEnd(15)} ${color('gray', bar)} ${s}`);
  }
  console.log();

  console.log(`  ${color('red', '✗ Failed:')} ${score.failed.length}`);
  console.log(`  ${color('yellow', '⚠ Warnings:')} ${score.warnings.length}`);
  console.log(`  ${color('green', '✓ Passed:')} ${score.passed.length}\n`);

  console.log(color('bold', 'Top 10 recommendations:\n'));
  for (const rec of score.recommendations) {
    console.log(`  ${rec}`);
  }
  console.log();
}

async function cmdFix(url: string, flags: Record<string, string | boolean>): Promise<number> {
  const cfg = await ensureConfig(flags['config'] as string | undefined);
  const s2m = createSiteToMcp(cfg);

  console.log(`${color('bold', '▸')} Audit + fix ${color('cyan', url)}\n`);
  const report = await s2m.audit(url);
  const fixResult = flags['apply'] ? s2m.applyFixes(report) : s2m.proposeFixes(report);

  console.log(color('bold', `Proposed fixes (${fixResult.applied.length}):\n`));
  for (const action of fixResult.applied) {
    console.log(`  ${color('green', '+')} ${action.id} ${color('dim', `(risk: ${action.risk})`)} — ${action.reason.slice(0, 100)}`);
  }
  console.log();

  if (fixResult.skipped.length > 0) {
    console.log(color('bold', `Skipped (${fixResult.skipped.length}):\n`));
    for (const s of fixResult.skipped) {
      console.log(`  ${color('yellow', '~')} ${s.id} — ${s.skipReason}`);
    }
    console.log();
  }

  if (fixResult.filesGenerated && fixResult.filesGenerated.length > 0) {
    console.log(color('bold', `Files generated (${fixResult.filesGenerated.length}):\n`));
    for (const f of fixResult.filesGenerated) {
      console.log(`  ${color('green', '+')} ${f.path} (${f.bytes} bytes)`);
    }
  }

  return 0;
}

async function cmdGenerate(file: string, flags: Record<string, string | boolean>): Promise<number> {
  const cfg = await ensureConfig(flags['config'] as string | undefined);
  const s2m = createSiteToMcp(cfg);
  let content = '';

  switch (file) {
    case 'llms.txt':
      content = s2m.generateLlmsTxt();
      break;
    case 'llms-full.txt':
      content = s2m.generateLlmsFullTxt().content;
      break;
    case 'robots.txt':
      content = s2m.generateRobotsTxt();
      break;
    case 'sitemap.xml':
      content = s2m.generateSitemapXml();
      break;
    case 'agent-card.json':
      content = s2m.generateAgentCard();
      break;
    case 'skill.md':
      content = s2m.generateSkillMd();
      break;
    case 'AGENTS.md':
      content = s2m.generateAgentsMd();
      break;
    case '_headers':
      content = s2m.generateHeadersFile();
      break;
    case 'ai.txt':
      content = s2m.generateAiTxt();
      break;
    default:
      console.error(color('red', `✗ Unknown file: ${file}`));
      console.error('  Available: llms.txt | llms-full.txt | robots.txt | sitemap.xml | agent-card.json | skill.md | AGENTS.md | _headers | ai.txt');
      return 1;
  }

  const out = flags['out'] as string | undefined;
  if (out) {
    await mkdir(dirname(resolve(out)), { recursive: true });
    await writeFile(out, content);
    console.log(color('green', `✓ Wrote ${out} (${content.length} bytes)`));
  } else {
    console.log(content);
  }
  return 0;
}

async function cmdServe(flags: Record<string, string | boolean>): Promise<number> {
  const cfg = await ensureConfig(flags['config'] as string | undefined);
  const s2m = createSiteToMcp(cfg);
  const port = Number(flags['port'] ?? 3030);

  const { createServer } = await import('node:http');

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${port}`);
    const path = url.pathname;

    const respond = (status: number, contentType: string, body: string) => {
      res.writeHead(status, { 'Content-Type': contentType });
      res.end(body);
    };

    if (path === '/llms.txt') return respond(200, 'text/plain; charset=utf-8', s2m.generateLlmsTxt());
    if (path === '/robots.txt') return respond(200, 'text/plain', s2m.generateRobotsTxt());
    if (path === '/sitemap.xml') return respond(200, 'application/xml', s2m.generateSitemapXml());
    if (path === '/skill.md') return respond(200, 'text/markdown', s2m.generateSkillMd());
    if (path === '/AGENTS.md') return respond(200, 'text/markdown', s2m.generateAgentsMd());
    if (path === '/.well-known/agent-card.json') return respond(200, 'application/json', s2m.generateAgentCard());
    if (path === '/_headers') return respond(200, 'text/plain', s2m.generateHeadersFile());
    if (path === (cfg.mcp?.path ?? '/.well-known/mcp.json')) {
      const mcp = s2m.createMCPServer();
      if (req.method === 'GET') return respond(200, 'application/json', JSON.stringify(mcp.manifest(), null, 2));
      if (req.method === 'POST') {
        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', async () => {
          const result = await mcp.handle(JSON.parse(body));
          respond(200, 'application/json', JSON.stringify(result));
        });
        return;
      }
    }
    if (path === '/') {
      return respond(200, 'text/html', `<!DOCTYPE html>
<title>site-to-mcp dev server</title>
<h1>site-to-mcp dev server</h1>
<p>Brand: <strong>${cfg.brand.name}</strong></p>
<p>Site URL: <code>${cfg.siteUrl}</code></p>
<h2>Endpoints</h2>
<ul>
  <li><a href="/llms.txt">/llms.txt</a></li>
  <li><a href="/robots.txt">/robots.txt</a></li>
  <li><a href="/sitemap.xml">/sitemap.xml</a></li>
  <li><a href="/skill.md">/skill.md</a></li>
  <li><a href="/AGENTS.md">/AGENTS.md</a></li>
  <li><a href="/.well-known/agent-card.json">/.well-known/agent-card.json</a></li>
  <li><a href="/.well-known/mcp.json">/.well-known/mcp.json</a></li>
  <li><a href="/_headers">/_headers</a></li>
</ul>`);
    }
    respond(404, 'text/plain', '404 Not Found');
  });

  server.listen(port, () => {
    console.log(color('green', `✓ Dev server: http://localhost:${port}/`));
    console.log(color('dim', '  Endpoints listed at /'));
    console.log(color('dim', '  Press Ctrl+C to stop'));
  });

  return new Promise(() => {}); // never resolves
}

async function cmdMonitor(flags: Record<string, string | boolean>): Promise<number> {
  const cfg = await ensureConfig(flags['config'] as string | undefined);
  if (!cfg.monitoring?.enabled) {
    console.error(color('red', '✗ Monitoring nie jest włączone w config'));
    return 1;
  }
  const s2m = createSiteToMcp(cfg);
  const monitor = s2m.createMonitor();
  console.log(color('bold', '▸ Running monitor...') + '\n');
  const checks = await monitor.run();
  console.log(color('green', `✓ ${checks.length} checks completed`) + '\n');

  const periodStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const periodEnd = new Date().toISOString();
  const report = monitor.generateReport(checks, periodStart, periodEnd);

  const out = flags['out'] as string | undefined;
  if (out) {
    await writeFile(out, monitor.reportToMarkdown(report));
    console.log(color('green', `✓ Wrote ${out}`));
  } else {
    console.log(monitor.reportToMarkdown(report));
  }
  return 0;
}

function printHelp(): void {
  console.log(`${color('bold', 'site-to-mcp')} ${color('dim', `v${VERSION}`)} — Universal SEO for LLM plugin

${color('bold', 'Komendy:')}
  init                          Interactive setup → s2m.config.json
  audit <url> [--threshold N]   Audit strony, A-F score, exit 2 if < threshold
  fix <url> [--apply]           Propose lub apply autofix (default: propose)
  verify <url>                  Post-deploy health check (12+ checks: AI files, MCP, AI bots access)
  generate <file> [--out path]  llms.txt | llms-full.txt | robots.txt | sitemap.xml | agent-card.json | skill.md | AGENTS.md | _headers | ai.txt
  serve [--port 3030]           Local dev server z wszystkimi endpoints
  monitor [--out report.md]     Run citation monitoring (wymaga config.monitoring)
  help                          To okno

${color('bold', 'Flagi globalne:')}
  --config <path>               Path do s2m.config.json (default: ./s2m.config.json)
  --json                        Output JSON zamiast human-readable
  --pagespeed-key <key>         Google PageSpeed Insights API key (dla layer Performance)

${color('bold', 'Przykłady:')}
  site-to-mcp init
  site-to-mcp audit https://example.com
  site-to-mcp audit https://example.com --threshold 80   # CI gate
  site-to-mcp fix https://example.com --apply
  site-to-mcp generate llms.txt --out public/llms.txt
  site-to-mcp serve --port 3030

${color('bold', 'Docs:')} https://github.com/vidokstudio/site-to-mcp
`);
}

// ============================================================================
// MAIN
// ============================================================================

async function main(): Promise<void> {
  const { cmd, positional, flags } = parseArgs(process.argv);
  let exitCode = 0;
  try {
    switch (cmd) {
      case 'init':
        await cmdInit();
        break;
      case 'audit': {
        const url = positional[0];
        if (!url) throw new Error('Missing <url>. Try: site-to-mcp audit https://example.com');
        exitCode = await cmdAudit(url, flags);
        break;
      }
      case 'fix': {
        const url = positional[0];
        if (!url) throw new Error('Missing <url>');
        exitCode = await cmdFix(url, flags);
        break;
      }
      case 'generate': {
        const file = positional[0];
        if (!file) throw new Error('Missing <file>. Try: site-to-mcp generate llms.txt');
        exitCode = await cmdGenerate(file, flags);
        break;
      }
      case 'serve':
        exitCode = await cmdServe(flags);
        break;
      case 'monitor':
        exitCode = await cmdMonitor(flags);
        break;
      case 'verify': {
        const url = positional[0];
        if (!url) throw new Error('Usage: site-to-mcp verify https://klient.pl');
        const report = await verifyDeploy(url);
        if (flags['json']) {
          console.log(JSON.stringify(report, null, 2));
        } else {
          const ico = report.overall === 'pass' ? color('green', '✓') : report.overall === 'partial' ? color('yellow', '⚠') : color('red', '✗');
          console.log(`${ico} ${color('bold', `Verify deploy: ${report.url}`)}`);
          console.log(`  ${color('green', `${report.passed} pass`)} · ${color('yellow', `${report.warnings} warn`)} · ${color('red', `${report.failed} fail`)}`);
          console.log();
          for (const c of report.checks) {
            const i = c.status === 'pass' ? color('green', '✓') : c.status === 'warn' ? color('yellow', '⚠') : color('red', '✗');
            console.log(`  ${i} ${c.name.padEnd(40)} ${color('dim', c.detail)}`);
          }
          if (report.recommendations.length > 0) {
            console.log('\n' + color('bold', 'Recommendations:'));
            for (const r of report.recommendations) console.log(`  ${r}`);
          }
        }
        exitCode = report.overall === 'fail' ? 2 : 0;
        break;
      }
      case 'help':
      case '--help':
      case '-h':
        printHelp();
        break;
      default:
        console.error(color('red', `✗ Unknown command: ${cmd}`));
        printHelp();
        exitCode = 1;
    }
  } catch (err) {
    console.error(color('red', `✗ ${err instanceof Error ? err.message : String(err)}`));
    exitCode = 1;
  }
  process.exit(exitCode);
}

main();
