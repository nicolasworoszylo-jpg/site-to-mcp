#!/usr/bin/env node
/**
 * s2m-autopilot CLI.
 *
 * Komendy:
 *   health                       — sprawdź Ollama + free APIs
 *   run <module> [--opts json]   — uruchom konkretny moduł
 *   keyword-research <seed>      — Google Autosuggest scrape
 *   rank-check <kw,kw,kw> --domain X
 *   alt-gen --url X              — generate alt dla obrazów na stronie
 *   broken-links --url X
 *   backlinks --domain X
 *   psi --url X
 *   refresh --pages list.json
 *   competitor --domains a,b,c
 *   indexnow --urls a,b,c
 *   report [--since 2026-05-01]
 *   schedule                     — start in-process scheduler
 *   launchagent --label X        — generuje plist do ~/Library/LaunchAgents/
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createSiteToMcp, type SiteToMcpConfig } from '@vidok/site-to-mcp';
import { createAutopilot } from '../factory.js';
import { generateLaunchAgentPlist } from '../scheduler/launchagent.js';
import { BakeOrchestrator } from '../bake/orchestrator.js';
import type { AutopilotConfig } from '../types.js';

const COLORS = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m',
};

function color(c: keyof typeof COLORS, t: string): string {
  return `${COLORS[c]}${t}${COLORS.reset}`;
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
      if (eq !== -1) flags[arg.slice(2, eq)] = arg.slice(eq + 1);
      else {
        const next = rest[i + 1];
        if (next && !next.startsWith('--')) { flags[arg.slice(2)] = next; i++; }
        else flags[arg.slice(2)] = true;
      }
    } else positional.push(arg);
  }
  return { cmd, positional, flags };
}

function loadConfig(path?: string): AutopilotConfig {
  const cfgPath = resolve(path ?? 'autopilot.config.json');
  const raw = JSON.parse(readFileSync(cfgPath, 'utf-8')) as { s2m: SiteToMcpConfig } & Omit<AutopilotConfig, 's2m'>;
  const s2m = createSiteToMcp(raw.s2m);
  return { ...raw, s2m };
}

async function main(): Promise<void> {
  const { cmd, positional, flags } = parseArgs(process.argv);
  let exitCode = 0;

  if (cmd === 'help' || cmd === '--help' || cmd === '-h') {
    printHelp();
    return;
  }

  try {
    const cfg = loadConfig(flags['config'] as string | undefined);
    const ap = createAutopilot(cfg);

    switch (cmd) {
      case 'health': {
        const h = await ap.healthCheck();
        console.log(JSON.stringify(h, null, 2));
        break;
      }
      case 'run': {
        const module = positional[0];
        if (!module) throw new Error('Missing module name');
        const optsJson = flags['opts'] as string | undefined;
        const opts = optsJson ? JSON.parse(optsJson) : undefined;
        const result = await ap.run(module as never, opts);
        console.log(JSON.stringify(result, null, 2));
        if (!result.ok) exitCode = 1;
        break;
      }
      case 'keyword-research': {
        const seed = positional[0];
        if (!seed) throw new Error('Missing seed keyword');
        const result = await ap.run('keyword-research', { seed, maxKeywords: Number(flags['max'] ?? 100) });
        console.log(color('green', `✓ ${result.summary}`));
        break;
      }
      case 'rank-check': {
        const kw = positional[0]?.split(',') ?? [];
        const domain = flags['domain'] as string;
        if (!kw.length || !domain) throw new Error('Usage: rank-check <kw,kw> --domain X');
        const result = await ap.run('rank-tracker', { keywords: kw, domain });
        console.log(JSON.stringify(result, null, 2));
        break;
      }
      case 'alt-gen': {
        const url = flags['url'] as string;
        if (!url) throw new Error('Missing --url');
        const result = await ap.run('alt-generator', { url });
        console.log(color('green', `✓ ${result.summary}`));
        if (flags['out']) writeFileSync(flags['out'] as string, (result.data as { html?: string })?.html ?? '');
        break;
      }
      case 'broken-links': {
        const url = flags['url'] as string;
        if (!url) throw new Error('Missing --url');
        const res = await fetch(url);
        const html = await res.text();
        const result = await ap.run('broken-links', { pages: [{ url, html }] });
        console.log(color('green', `✓ ${result.summary}`));
        break;
      }
      case 'backlinks': {
        const domain = flags['domain'] as string;
        if (!domain) throw new Error('Missing --domain');
        const result = await ap.run('backlink-monitor', { targetDomain: domain });
        console.log(color('green', `✓ ${result.summary}`));
        break;
      }
      case 'psi': {
        const url = flags['url'] as string;
        if (!url) throw new Error('Missing --url');
        const result = await ap.run('psi-monitor', { urls: [url] });
        console.log(JSON.stringify(result, null, 2));
        break;
      }
      case 'competitor': {
        const domains = (flags['domains'] as string).split(',').map((d) => d.trim());
        const result = await ap.run('competitor-tracker', { domains });
        console.log(color('green', `✓ ${result.summary}`));
        break;
      }
      case 'indexnow': {
        const urls = (flags['urls'] as string).split(',').map((u) => u.trim());
        const result = await ap.run('indexnow-push', { urls });
        console.log(color('green', `✓ ${result.summary}`));
        break;
      }
      case 'report': {
        const since = flags['since'] as string | undefined;
        const md = ap.report({ ...(since ? { since } : {}) });
        const out = flags['out'] as string | undefined;
        if (out) {
          writeFileSync(out, md);
          console.log(color('green', `✓ Wrote ${out}`));
        } else {
          console.log(md);
        }
        break;
      }
      case 'schedule': {
        console.log(color('bold', '▸ Starting scheduler...'));
        ap.startScheduler();
        // Block forever
        process.on('SIGINT', () => {
          ap.close();
          process.exit(0);
        });
        await new Promise(() => {});
        break;
      }
      case 'bake': {
        const site = (flags['site'] as string) ?? cfg.s2m.config.siteUrl;
        const outDir = (flags['out'] as string) ?? './seo-bake';
        const maxPages = Number(flags['max'] ?? 100);
        const refresh = flags['refresh'] === true || flags['refresh'] === 'true';
        const modulesStr = flags['modules'] as string | undefined;
        const modules = modulesStr ? (modulesStr.split(',').filter(Boolean) as Array<'alt' | 'rewrite' | 'faq' | 'schema' | 'markdown'>) : undefined;

        console.log(color('bold', '▸ Baking site → static files'));
        console.log(color('dim', `  Site: ${site}`));
        console.log(color('dim', `  Out: ${outDir}`));
        console.log(color('dim', `  Max pages: ${maxPages}`));
        if (refresh) console.log(color('dim', `  Refresh mode: only changed pages`));
        if (modules) console.log(color('dim', `  Modules: ${modules.join(', ')}`));

        const orchestrator = new BakeOrchestrator(cfg.s2m, cfg);
        const manifest = await orchestrator.bake({
          site,
          outDir,
          maxPages,
          refresh,
          ...(modules ? { modules } : {}),
        });

        console.log();
        console.log(color('green', `✓ Bake complete`));
        console.log(`  ${manifest.totalPages} pages, ${manifest.totalImages} images`);
        console.log(`  ${manifest.staticFiles.length} static files generated`);
        console.log(`  ${Math.round(manifest.durationMs / 1000)}s total`);
        console.log();
        console.log(color('bold', 'Deploy this folder:'));
        console.log(`  ${outDir}`);
        console.log();
        console.log(color('bold', 'Use in your app:'));
        console.log(color('cyan', `  const s2m = createSiteToMcp({ siteUrl, brand, bakedDir: '${outDir}' });`));
        console.log(color('dim', `  Strona "żyje własnym życiem" — zero LLM runtime, zero subskrypcji.`));
        break;
      }
      case 'launchagent': {
        const label = (flags['label'] as string) ?? 'pl.vidok.s2m-autopilot';
        const interval = Number(flags['interval'] ?? 3600);
        const plist = generateLaunchAgentPlist({
          label,
          command: [process.execPath, resolve(process.argv[1] ?? ''), 'schedule', '--config', resolve(flags['config'] as string ?? 'autopilot.config.json')],
          workingDirectory: process.cwd(),
          intervalSeconds: interval,
          stdout: resolve('autopilot.stdout.log'),
          stderr: resolve('autopilot.stderr.log'),
        });
        const out = flags['out'] as string | undefined;
        if (out) {
          writeFileSync(out, plist);
          console.log(color('green', `✓ Wrote ${out}`));
          console.log(color('dim', `  Load: launchctl load ${out}`));
        } else {
          console.log(plist);
        }
        break;
      }
      default:
        console.error(color('red', `✗ Unknown command: ${cmd}`));
        printHelp();
        exitCode = 1;
    }
    ap.close();
  } catch (err) {
    console.error(color('red', `✗ ${err instanceof Error ? err.message : String(err)}`));
    exitCode = 1;
  }
  process.exit(exitCode);
}

function printHelp(): void {
  console.log(`${color('bold', 's2m-autopilot')} ${color('dim', 'v1.0.0')} — Zero-subscription SEO automation

${color('bold', 'Komendy:')}
  bake [--site URL] [--out DIR]       Pre-compute WSZYSTKO na statyczne pliki (Ollama wymagana)
                                      Po bake strona "żyje własnym życiem" bez LLM
       [--max N] [--refresh]
       [--modules alt,rewrite,faq,schema,markdown]
  health                              Status Ollama + free APIs
  run <module> [--opts json]          Uruchom dowolny moduł
  keyword-research <seed> [--max N]   Google Autosuggest scrape
  rank-check <kw,kw> --domain X       SERP rank tracking
  alt-gen --url X [--out html]        Generate alt z Ollama vision
  broken-links --url X                Scan brak linków
  backlinks --domain X                Common Crawl backlinks
  psi --url X                         PageSpeed Insights monitor
  competitor --domains a,b,c          Crawl konkurencji
  indexnow --urls a,b,c               Push do Bing IndexNow + Google Indexing
  report [--since YYYY-MM-DD]         Weekly markdown raport
  schedule                            Start in-process scheduler (Ctrl+C stop)
  launchagent --label X --interval N  Generuje plist dla macOS LaunchAgent

${color('bold', 'Flagi globalne:')}
  --config <path>                     Path do autopilot.config.json
  --out <path>                        Zapisz output do pliku

${color('bold', 'Modules (15):')}
  keyword-research, rank-tracker, alt-generator, content-rewriter,
  internal-linking, broken-links, backlink-monitor, competitor-tracker,
  content-refresh, gsc-sync, psi-monitor, indexnow-push,
  hreflang-validator, canonical-validator, lighthouse-audit

Zero zewnętrznych subskrypcji. Wszystko lokalnie (Ollama) + free APIs.
`);
}

main();
