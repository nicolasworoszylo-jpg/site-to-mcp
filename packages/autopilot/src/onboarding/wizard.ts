/**
 * Onboarding Wizard — interactive 1-day workflow.
 *
 * Flow:
 *   1. Welcome — wyjaśnia co się stanie
 *   2. Audit — pełen audit obecnej strony klienta (A-F score)
 *   3. Setup — interactive prompts: brand info, autor, keywords, competitors
 *   4. Industry preset auto-suggest na podstawie URL/title detection
 *   5. Generate s2m.config.json + autopilot.config.json
 *   6. Bake — pełen bake z Ollama (5-30 min)
 *   7. Citation scoring per page → top recommendations
 *   8. Outreach generator → top 10 candidates dla brand mentions
 *   9. Generate deploy instructions per stack (Next.js/WP/static)
 *   10. Final report + checklist do follow-up
 */

import { createInterface } from 'node:readline/promises';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createSiteToMcp, audit, scoreCitation, extractContent } from '@vidok/site-to-mcp';
import type { Industry } from '../wisepeople/types.js';
import { BakeOrchestrator } from '../bake/orchestrator.js';
import { OllamaClient } from '../ollama/client.js';
import { AutopilotStorage } from '../storage/db.js';
import { OutreachGeneratorModule } from '../modules/outreach-generator.js';
import { INDUSTRY_PRESETS } from '../wisepeople/templates.js';

export interface WizardOptions {
  /** URL klienta — required */
  siteUrl: string;
  /** Output directory (default ./<client-slug>/) */
  outDir?: string;
  /** Skip interactive prompts (use defaults) */
  nonInteractive?: boolean;
  /** Pre-filled answers (gdy nonInteractive) */
  answers?: Partial<WizardAnswers>;
  /** Ollama URL */
  ollamaUrl?: string;
  /** Verbose log */
  log?: (msg: string) => void;
}

export interface WizardAnswers {
  brandName: string;
  brandDescription: string;
  brandLogo?: string;
  primaryAuthorName: string;
  primaryAuthorRole: string;
  primaryAuthorLinkedIn?: string;
  contactEmail: string;
  contactPhone?: string;
  industry: Industry;
  targetKeywords: string[];
  competitors: string[];
  allowTraining: boolean; // GPTBot/ClaudeBot disallow=false?
  sameAs: string[];
}

export interface WizardResult {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  outDir: string;
  answers: WizardAnswers;
  bakeManifest?: unknown;
  citationScores?: Array<{ path: string; score: number; grade: string; topRecs: string[] }>;
  outreachCandidates?: number;
  deployInstructions: string;
  followUpChecklist: string[];
}

export class OnboardingWizard {
  private log: (msg: string) => void;
  private rl?: ReturnType<typeof createInterface>;

  constructor(private opts: WizardOptions) {
    this.log = opts.log ?? ((m) => console.log(m));
    if (!opts.nonInteractive) {
      this.rl = createInterface({ input: process.stdin, output: process.stdout });
    }
  }

  async run(): Promise<WizardResult> {
    const start = Date.now();
    const startedAt = new Date().toISOString();

    this.print('\n══════════════════════════════════════════════════════════');
    this.print('  site-to-mcp — Onboarding Wizard');
    this.print('  Jeden dzień. Od audytu do deploy. $0 recurring.');
    this.print('══════════════════════════════════════════════════════════\n');

    // STEP 1: Audit
    this.print('▶ Krok 1/8: Audit obecnej strony...');
    const baseReport = await audit({ url: this.opts.siteUrl, testAiBots: true });
    this.print(`  Overall score: ${baseReport.scores.overall}/100`);
    this.print(`  Findings: ${baseReport.findings.length} (${baseReport.findings.filter((f) => f.status === 'fail').length} fail, ${baseReport.findings.filter((f) => f.status === 'warning').length} warning)`);
    if (baseReport.meta.rendering === 'csr') {
      this.print('  ⚠️ CSR detected — AI nie wykonuje JS. Po bake klient powinien przemyśleć SSR.');
    }

    // STEP 2: Setup — interactive prompts
    this.print('\n▶ Krok 2/8: Konfiguracja klienta');
    const answers = await this.collectAnswers(baseReport.meta);

    // STEP 3: Output dirs
    const slug = answers.brandName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const outDir = this.opts.outDir ?? resolve(`./${slug}`);
    const bakeDir = resolve(outDir, 'seo-bake');
    mkdirSync(outDir, { recursive: true });
    this.print(`\n▶ Krok 3/8: Output: ${outDir}`);

    // STEP 4: Generate configs
    this.print('▶ Krok 4/8: Generuję s2m.config.json + autopilot.config.json');
    const s2mConfig = this.buildS2mConfig(answers);
    const autopilotConfig = {
      s2m: s2mConfig,
      ollamaUrl: this.opts.ollamaUrl ?? 'http://localhost:11434',
    };
    writeFileSync(resolve(outDir, 's2m.config.json'), JSON.stringify(s2mConfig, null, 2));
    writeFileSync(resolve(outDir, 'autopilot.config.json'), JSON.stringify(autopilotConfig, null, 2));
    this.print(`  ✓ ${resolve(outDir, 's2m.config.json')}`);
    this.print(`  ✓ ${resolve(outDir, 'autopilot.config.json')}`);

    // STEP 5: Check Ollama
    this.print('\n▶ Krok 5/8: Sprawdzam Ollama...');
    const ollama = new OllamaClient({ ...(this.opts.ollamaUrl ? { baseUrl: this.opts.ollamaUrl } : {}) });
    const health = await ollama.health();
    if (!health.ok) {
      this.print(`  ✗ Ollama unavailable: ${health.error}`);
      this.print('  Skip bake — uruchom później: npx s2m-autopilot bake --site ' + this.opts.siteUrl);
    } else {
      this.print(`  ✓ Ollama OK. Models: ${Object.entries(health.modelsAvailable).filter(([, v]) => v).map(([k]) => k).join(', ')}`);
    }

    // STEP 6: Bake
    let bakeManifest: unknown;
    let citationScores: WizardResult['citationScores'] = [];
    if (health.ok) {
      this.print('\n▶ Krok 6/8: Bake — pre-compute wszystkiego (5-30 min)');
      const s2m = createSiteToMcp(s2mConfig);
      const orchestrator = new BakeOrchestrator(s2m, { s2m, ...(this.opts.ollamaUrl ? { ollamaUrl: this.opts.ollamaUrl } : {}), log: (m) => this.print(`  ${m}`) });
      try {
        bakeManifest = await orchestrator.bake({
          site: this.opts.siteUrl,
          outDir: bakeDir,
          maxPages: 100,
        });
        this.print(`  ✓ Bake complete: ${(bakeManifest as { totalPages: number }).totalPages} pages, ${(bakeManifest as { totalImages: number }).totalImages} alt-texts`);

        // STEP 7: Citation scoring (top 5 stron)
        this.print('\n▶ Krok 7/8: Citation worthiness scoring (top 5 stron)');
        const manifest = bakeManifest as { pages: Array<{ path: string }> };
        const topPaths = manifest.pages.slice(0, 5);
        for (const p of topPaths) {
          try {
            const res = await fetch(new URL(p.path, this.opts.siteUrl).toString(), { signal: AbortSignal.timeout(10_000) });
            if (!res.ok) continue;
            const html = await res.text();
            const url = new URL(p.path, this.opts.siteUrl).toString();
            const content = extractContent({ url, html });
            const score = scoreCitation({
              content,
              schemaTypesCount: content.schemaFound.length,
              hasFaqSchema: content.schemaFound.some((s) => s.type === 'FAQPage'),
              hasPersonSchema: content.schemaFound.some((s) => s.type === 'Person'),
            });
            citationScores.push({
              path: p.path,
              score: score.overall,
              grade: score.grade,
              topRecs: score.recommendations.slice(0, 3).map((r) => r.action),
            });
            this.print(`  ${p.path.padEnd(40)} ${score.grade} (${score.overall}/100)`);
          } catch {
            // skip
          }
        }
      } catch (err) {
        this.print(`  ✗ Bake failed: ${err}`);
      }
    }

    // STEP 8: Outreach (opcjonalnie, gdy keywords + competitors)
    let outreachCandidates = 0;
    if (health.ok && answers.targetKeywords.length > 0 && answers.competitors.length > 0) {
      this.print('\n▶ Krok 8/8: Outreach generator — szukam citation gaps (5-15 min)');
      const storage = new AutopilotStorage(resolve(outDir, 'autopilot.db'));
      const outreachModule = new OutreachGeneratorModule(storage, {
        s2m: createSiteToMcp(s2mConfig),
        ...(this.opts.ollamaUrl ? { ollamaUrl: this.opts.ollamaUrl } : {}),
      });
      try {
        const result = await outreachModule.run({
          brandName: answers.brandName,
          brandUrl: this.opts.siteUrl,
          brandPitch: answers.brandDescription,
          keywords: answers.targetKeywords.slice(0, 3), // top 3 do oszczędzenia czasu
          competitors: answers.competitors,
          language: 'pl',
          perKeyword: 5,
        });
        outreachCandidates = result.itemsChanged ?? 0;
        this.print(`  ✓ Found ${outreachCandidates} outreach candidates → autopilot.db (table run_log)`);
      } catch (err) {
        this.print(`  ⚠️ Outreach skipped: ${err}`);
      }
      storage.close();
    } else {
      this.print('\n▶ Krok 8/8: Outreach skipped (wymaga keywords + competitors + Ollama)');
    }

    // Final report
    const deployInstructions = this.deployInstructions(slug, bakeDir, this.opts.siteUrl);
    const followUpChecklist = this.followUpChecklist(answers, citationScores ?? []);

    this.print('\n══════════════════════════════════════════════════════════');
    this.print('  ✓ Onboarding complete');
    this.print('══════════════════════════════════════════════════════════');
    this.print(`\nOutput: ${outDir}`);
    this.print(`Bake: ${bakeDir}`);
    this.print(`\n${deployInstructions}\n`);

    writeFileSync(resolve(outDir, 'ONBOARDING_REPORT.md'), this.markdownReport(answers, baseReport, citationScores ?? [], outreachCandidates, deployInstructions, followUpChecklist));
    this.print(`Pełen raport: ${resolve(outDir, 'ONBOARDING_REPORT.md')}\n`);

    this.rl?.close();

    return {
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - start,
      outDir,
      answers,
      bakeManifest,
      citationScores,
      outreachCandidates,
      deployInstructions,
      followUpChecklist,
    };
  }

  private async collectAnswers(_meta: unknown): Promise<WizardAnswers> {
    if (this.opts.nonInteractive) {
      const defaults: WizardAnswers = {
        brandName: 'Brand',
        brandDescription: '',
        primaryAuthorName: 'Founder',
        primaryAuthorRole: 'Founder',
        contactEmail: '',
        industry: 'b2b-services',
        targetKeywords: [],
        competitors: [],
        allowTraining: false,
        sameAs: [],
      };
      return { ...defaults, ...this.opts.answers };
    }
    const ask = async (q: string, def?: string): Promise<string> => {
      const ans = (await this.rl!.question(`  ${q}${def ? ` [${def}]` : ''}: `)).trim();
      return ans || def || '';
    };
    const askList = async (q: string): Promise<string[]> => {
      const ans = await ask(`${q} (comma-separated)`);
      return ans.split(',').map((s) => s.trim()).filter(Boolean);
    };
    const askYN = async (q: string, def = 'n'): Promise<boolean> => {
      return (await ask(`${q} (y/n)`, def)).toLowerCase().startsWith('y');
    };

    const brandName = await ask('Brand name');
    const brandDescription = await ask('Brand description (1-2 zdania)');
    const brandLogo = await ask('Logo URL (opcjonalne)');
    const primaryAuthorName = await ask('Main author / founder name');
    const primaryAuthorRole = await ask('Author job title', 'Founder');
    const primaryAuthorLinkedIn = await ask('Author LinkedIn URL (opcjonalne)');
    const contactEmail = await ask('Contact email');
    const contactPhone = await ask('Contact phone (opcjonalne)');

    this.print('\n  Industry options: b2b-saas, b2b-services, b2c-ecommerce, b2c-local, blog-publisher, corporate, nonprofit, portfolio, directory');
    const industry = (await ask('Industry', 'b2b-services')) as Industry;

    const targetKeywords = await askList('Target keywords (5-10 najlepiej)');
    const competitors = await askList('Konkurencja (domeny, np. rival1.pl,rival2.com)');
    const sameAs = await askList('sameAs URLs (LinkedIn company, GitHub, Crunchbase, Wikipedia)');
    const allowTraining = await askYN('Pozwól na AI training (GPTBot/ClaudeBot)?', 'n');

    return {
      brandName,
      brandDescription,
      ...(brandLogo ? { brandLogo } : {}),
      primaryAuthorName,
      primaryAuthorRole,
      ...(primaryAuthorLinkedIn ? { primaryAuthorLinkedIn } : {}),
      contactEmail,
      ...(contactPhone ? { contactPhone } : {}),
      industry,
      targetKeywords,
      competitors,
      allowTraining,
      sameAs,
    };
  }

  private buildS2mConfig(a: WizardAnswers): Parameters<typeof createSiteToMcp>[0] {
    const preset = INDUSTRY_PRESETS[a.industry];
    const baseBots = preset.aiBots;
    const aiBots = {
      ...baseBots,
      GPTBot: a.allowTraining,
      ClaudeBot: a.allowTraining,
      'Google-Extended': a.allowTraining,
    };
    return {
      siteUrl: this.opts.siteUrl,
      brand: {
        name: a.brandName,
        description: a.brandDescription,
        ...(a.brandLogo ? { logo: a.brandLogo } : {}),
        sameAs: a.sameAs,
        contact: {
          ...(a.contactEmail ? { email: a.contactEmail } : {}),
          ...(a.contactPhone ? { phone: a.contactPhone } : {}),
        },
        primaryAuthor: {
          name: a.primaryAuthorName,
          jobTitle: a.primaryAuthorRole,
          ...(a.primaryAuthorLinkedIn ? { sameAs: [a.primaryAuthorLinkedIn] } : {}),
        },
      },
      aiBots: aiBots as never,
    };
  }

  private deployInstructions(_slug: string, bakeDir: string, siteUrl: string): string {
    return `═══ DEPLOY ═══

Wybierz stack klienta:

▸ Next.js:
    1. Skopiuj ${bakeDir} do public/seo-bake/
    2. middleware.ts:
       import { siteToMcpMiddleware } from '@vidok/site-to-mcp/next';
       export const middleware = siteToMcpMiddleware({
         ...config,
         bakedDir: './public/seo-bake',
       });
    3. npm run build && deploy

▸ WordPress:
    1. Skopiuj wp-content/plugins/site-to-mcp/site-to-mcp.php (z packages/core/src/adapters/wordpress/)
    2. Aktywuj plugin + Save permalinks
    3. Upload ${bakeDir} do wp-content/uploads/seo-bake/
    4. Settings → Site to MCP → "Baked content dir": wp-content/uploads/seo-bake/

▸ Statyczna (HTML/Astro/Hugo):
    1. Skopiuj contents ${bakeDir} do public root strony
    2. Endpointy działają automatycznie: ${siteUrl}/llms.txt, /sitemap.xml, /.well-known/mcp.json

Weryfikacja po deploy:
    curl ${siteUrl}/llms.txt
    curl ${siteUrl}/.well-known/mcp.json
    curl -H "Accept: text/markdown" ${siteUrl}/

Test w Claude Desktop (~/Library/Application Support/Claude/claude_desktop_config.json):
    {
      "mcpServers": {
        "${_slug}": {
          "url": "${siteUrl}/.well-known/mcp.json"
        }
      }
    }`;
  }

  private followUpChecklist(_a: WizardAnswers, scores: NonNullable<WizardResult['citationScores']>): string[] {
    const checklist: string[] = [];
    checklist.push('Sprawdź pierwsze 3 endpointy curl-em po deploy');
    checklist.push('Wpisz w Claude Desktop config (do user testing)');
    checklist.push('Zarejestruj w Google Search Console (free)');
    checklist.push('Zarejestruj w Bing Webmaster Tools (free)');
    if (scores.some((s) => s.score < 70)) {
      checklist.push(`Popraw content per recommendations (${scores.filter((s) => s.score < 70).length} stron < B grade)`);
    }
    checklist.push('Ad-hoc rank check za 2 tygodnie: s2m-autopilot rank-check');
    checklist.push('Refresh bake za 3 miesiące: s2m-autopilot bake --refresh');
    return checklist;
  }

  private markdownReport(
    a: WizardAnswers,
    baseReport: { scores: { overall: number }; findings: Array<{ status: string }> },
    scores: NonNullable<WizardResult['citationScores']>,
    outreachCandidates: number,
    deployInstructions: string,
    followUp: string[],
  ): string {
    const lines: string[] = [];
    lines.push(`# Onboarding report — ${a.brandName}`);
    lines.push(`**Date:** ${new Date().toISOString().slice(0, 10)}`);
    lines.push(`**Site:** ${this.opts.siteUrl}`);
    lines.push(`**Industry:** ${a.industry}`);
    lines.push('');
    lines.push('## Initial audit');
    lines.push(`- Overall score: **${baseReport.scores.overall}/100**`);
    lines.push(`- Findings: ${baseReport.findings.length} (${baseReport.findings.filter((f) => f.status === 'fail').length} fail)`);
    lines.push('');
    if (scores.length > 0) {
      lines.push('## Citation worthiness (top 5 pages)');
      lines.push('');
      lines.push('| Path | Score | Grade | Top recommendations |');
      lines.push('|------|-------|-------|---------------------|');
      for (const s of scores) {
        lines.push(`| ${s.path} | ${s.score} | ${s.grade} | ${s.topRecs.join(' · ')} |`);
      }
      lines.push('');
    }
    if (outreachCandidates > 0) {
      lines.push(`## Outreach: ${outreachCandidates} candidates found`);
      lines.push(`See autopilot.db → run_log dla detali. Top 5 z emailami w ostatnim run.`);
      lines.push('');
    }
    lines.push('## Target keywords');
    for (const k of a.targetKeywords) lines.push(`- ${k}`);
    lines.push('');
    lines.push('## Competitors');
    for (const c of a.competitors) lines.push(`- ${c}`);
    lines.push('');
    lines.push('## Deploy instructions');
    lines.push('');
    lines.push('```');
    lines.push(deployInstructions);
    lines.push('```');
    lines.push('');
    lines.push('## Follow-up checklist');
    for (const item of followUp) lines.push(`- [ ] ${item}`);
    return lines.join('\n');
  }

  private print(msg: string): void {
    this.log(msg);
  }
}
