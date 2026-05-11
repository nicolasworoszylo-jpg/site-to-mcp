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
import { Registry, loadRegistry } from '../wisepeople/registry.js';
import { BulkBakeOrchestrator } from '../wisepeople/bulk-bake.js';
import { Dashboard } from '../wisepeople/dashboard.js';
import { Deployer } from '../wisepeople/deploy.js';
import { listIndustries, getIndustryPreset } from '../wisepeople/templates.js';
import type { Industry } from '../wisepeople/types.js';
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

  // === WP commands (multi-tenant) — działają BEZ autopilot.config.json ===
  if (cmd === 'wp') {
    try {
      const subcmd = positional[0];
      const registryPath = (flags['registry'] as string) ?? 'wisepeople.clients.json';
      const registry = new Registry(resolve(registryPath));

      switch (subcmd) {
        case 'init': {
          const agencyName = (flags['agency'] as string) ?? 'Wise People';
          const agencySlug = (flags['slug'] as string) ?? 'wise-people';
          const portfolioDir = (flags['portfolio'] as string) ?? './wisepeople-portfolio';
          registry.init({ name: agencyName, slug: agencySlug }, portfolioDir);
          console.log(color('green', `✓ Created registry at ${registryPath}`));
          console.log(color('dim', `  Agency: ${agencyName} (${agencySlug})`));
          console.log(color('dim', `  Portfolio dir: ${portfolioDir}`));
          console.log();
          console.log('Next:');
          console.log(color('cyan', `  s2m-autopilot wp add-client --slug klient1 --name "Klient 1" --url https://klient1.pl --industry b2c-local`));
          break;
        }
        case 'industries': {
          console.log(color('bold', 'Available industries:'));
          for (const ind of listIndustries()) {
            const preset = getIndustryPreset(ind);
            console.log(`  ${color('cyan', ind.padEnd(18))} ${preset.description}`);
          }
          break;
        }
        case 'add-client': {
          const slug = flags['slug'] as string;
          const name = flags['name'] as string;
          const url = flags['url'] as string;
          const industry = (flags['industry'] as string) as Industry;
          if (!slug || !name || !url || !industry) {
            throw new Error('Usage: wp add-client --slug X --name "Y" --url https://Y.pl --industry b2c-local');
          }
          const keywordsStr = flags['keywords'] as string | undefined;
          const targetKeywords = keywordsStr ? keywordsStr.split(',').map((k) => k.trim()) : [];
          registry.addClient({
            slug,
            name,
            siteUrl: url,
            industry,
            brand: { name },
            targetKeywords,
            ...(flags['competitors'] ? { competitors: (flags['competitors'] as string).split(',').map((c) => c.trim()) } : {}),
            ...(flags['deploy-method']
              ? {
                  deploy: {
                    method: flags['deploy-method'] as 'rsync' | 'git' | 'sftp' | 'manual',
                    ...(flags['deploy-target'] ? { target: flags['deploy-target'] as string } : {}),
                  },
                }
              : {}),
            tags: flags['tags'] ? (flags['tags'] as string).split(',').map((t) => t.trim()) : ['wise-people'],
          });
          console.log(color('green', `✓ Added client: ${slug} (${name})`));
          break;
        }
        case 'list': {
          const reg = registry.load();
          const industryFilter = flags['industry'] as Industry | undefined;
          const list = registry.listClients({ ...(industryFilter ? { industry: industryFilter } : {}) });
          console.log(color('bold', `${reg.agency.name} — ${list.length} clients`));
          console.log();
          for (const c of list) {
            const status = c.active === false ? color('dim', '⊘ inactive') : color('green', '✓ active');
            console.log(`  ${color('cyan', c.slug.padEnd(20))} ${c.name.padEnd(30)} ${c.industry.padEnd(18)} ${status}`);
            console.log(`    ${color('dim', c.siteUrl)}`);
          }
          break;
        }
        case 'remove-client': {
          const slug = flags['slug'] as string;
          if (!slug) throw new Error('Usage: wp remove-client --slug X');
          registry.removeClient(slug);
          console.log(color('green', `✓ Removed client: ${slug}`));
          break;
        }
        case 'bake-all': {
          const ollamaUrl = (flags['ollama'] as string) ?? 'http://localhost:11434';
          const concurrency = Number(flags['concurrency'] ?? 3);
          const refresh = flags['refresh'] === true || flags['refresh'] === 'true';
          const resume = flags['resume'] === true || flags['resume'] === 'true';
          const industryFilter = flags['industry'] as string | undefined;
          const tagFilter = flags['tag'] as string | undefined;
          const slugsCsv = flags['clients'] as string | undefined;

          const baseAutopilotConfig: AutopilotConfig = {
            // dummy s2m — bulk-bake create per-client
            s2m: createSiteToMcp({ siteUrl: registry.load().agency.slug, brand: { name: registry.load().agency.name } }),
            ollamaUrl,
            log: (m) => console.log(color('dim', m)),
          };

          const bulk = new BulkBakeOrchestrator(registry, baseAutopilotConfig);
          console.log(color('bold', `▸ Bulk bake — concurrency: ${concurrency}${refresh ? ', refresh mode' : ''}`));

          const result = await bulk.bake({
            concurrency,
            refresh,
            resume,
            ...(industryFilter ? { industry: industryFilter } : {}),
            ...(tagFilter ? { tag: tagFilter } : {}),
            ...(slugsCsv ? { clientSlugs: slugsCsv.split(',').map((s) => s.trim()) } : {}),
          });

          console.log();
          console.log(color('bold', '═══════════════════════════════════════════'));
          console.log(`  ${color('green', `✓ Succeeded: ${result.succeeded}`)}`);
          console.log(`  ${color('red', `✗ Failed: ${result.failed}`)}`);
          console.log(`  ⏳ Skipped: ${result.skipped}`);
          console.log(`  Total pages baked: ${result.totalPagesBaked}`);
          console.log(`  Total alt-texts: ${result.totalImagesGenerated}`);
          console.log(`  Total time: ${Math.round(result.totalDurationMs / 1000 / 60)} min`);
          console.log(`  State file: ${result.stateFile}`);
          break;
        }
        case 'status': {
          const baseAutopilotConfig: AutopilotConfig = {
            s2m: createSiteToMcp({ siteUrl: registry.load().agency.slug, brand: { name: registry.load().agency.name } }),
          };
          const bulk = new BulkBakeOrchestrator(registry, baseAutopilotConfig);
          const state = bulk.status();
          if (!state) {
            console.log(color('dim', 'No previous bake state found'));
            break;
          }
          const reg = registry.load();
          console.log(color('bold', `${reg.agency.name} — bake state`));
          console.log(color('dim', `Started: ${state.startedAt}`));
          console.log();
          for (const job of Object.values(state.jobs)) {
            const icon = job.state === 'done' ? color('green', '✓') : job.state === 'failed' ? color('red', '✗') : job.state === 'running' ? color('cyan', '▶') : '⏳';
            const dur = job.durationMs ? color('dim', ` ${Math.round(job.durationMs / 1000)}s`) : '';
            const pages = job.pagesBaked ? color('dim', ` ${job.pagesBaked}p`) : '';
            console.log(`  ${icon} ${job.clientSlug.padEnd(20)} ${job.state.padEnd(10)}${dur}${pages}`);
          }
          break;
        }
        case 'dashboard': {
          const dashboard = new Dashboard(registry);
          const format = (flags['format'] as string) ?? 'markdown';
          const out = flags['out'] as string | undefined;

          let content: string;
          if (format === 'html') content = dashboard.html();
          else if (format === 'json') content = JSON.stringify(dashboard.summary(), null, 2);
          else content = dashboard.markdown();

          if (out) {
            const { writeFileSync: w, mkdirSync: m } = await import('node:fs');
            const { dirname: d } = await import('node:path');
            m(d(resolve(out)), { recursive: true });
            w(resolve(out), content);
            console.log(color('green', `✓ Wrote ${out}`));
          } else {
            console.log(content);
          }
          break;
        }
        case 'deploy-all': {
          const deployer = new Deployer(registry);
          const dryRun = flags['dry-run'] === true || flags['dry-run'] === 'true';
          const slugsCsv = flags['clients'] as string | undefined;
          console.log(color('bold', `▸ Bulk deploy${dryRun ? ' (dry-run)' : ''}`));
          const result = await deployer.deployAll({
            dryRun,
            ...(slugsCsv ? { clientSlugs: slugsCsv.split(',').map((s) => s.trim()) } : {}),
          });
          console.log();
          console.log(`  ${color('green', `✓ Succeeded: ${result.succeeded}`)}`);
          console.log(`  ${color('red', `✗ Failed: ${result.failed}`)}`);
          console.log(`  ⓘ Manual: ${result.manual}`);
          break;
        }
        default:
          console.error(color('red', `Unknown wp subcommand: ${subcmd}`));
          console.log(`  Available: init, industries, add-client, list, remove-client, bake-all, status, dashboard, deploy-all`);
          exitCode = 1;
      }
    } catch (err) {
      console.error(color('red', `✗ ${err instanceof Error ? err.message : String(err)}`));
      exitCode = 1;
    }
    process.exit(exitCode);
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
  bake [--site URL] [--out DIR]       Pre-compute jednej strony na statyczne pliki
       [--max N] [--refresh]
       [--modules alt,rewrite,faq,schema,markdown]

${color('bold', 'Multi-tenant (Wise People / agency 100+ klientów):')}
  wp init [--agency X --slug Y]       Stwórz wisepeople.clients.json registry
  wp industries                       Lista 9 industry presets
  wp add-client --slug X --name "Y"   Dodaj klienta do registry
                --url URL --industry I
                [--keywords k,k,k] [--competitors c,c]
                [--deploy-method rsync|git|sftp|manual]
                [--deploy-target target] [--tags t,t]
  wp list [--industry I]              Lista wszystkich klientów
  wp remove-client --slug X
  wp bake-all [--concurrency N=3]     Bulk bake 100+ klientów paralelnie
              [--refresh] [--resume]  resumable + skip-already-done
              [--clients csv]
              [--industry I] [--tag T]
  wp status                           Pokaż stan ostatniego bulk bake
  wp dashboard [--format md|html|json] Aggregate raport (markdown/HTML/JSON)
               [--out PATH]
  wp deploy-all [--dry-run]           Bulk deploy do wszystkich klientów
                [--clients csv]

${color('bold', 'Single-tenant:')}
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
