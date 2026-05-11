/**
 * Aggregate dashboard — executive view dla 100+ klientów.
 *
 * Output:
 *   - Markdown raport (do Slack/email/Notion)
 *   - HTML dashboard (jeden plik, do hostowania na S3 albo open lokalnie)
 *   - JSON dla custom processing
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Registry } from './registry.js';
import type { PortfolioSummary, BakeStateFile, ClientEntry } from './types.js';

export class Dashboard {
  constructor(private registry: Registry) {}

  /**
   * Generuje pełen summary z bake state + manifests klientów.
   */
  summary(stateFile?: string): PortfolioSummary {
    const registry = this.registry.load();
    const state = this.loadState(stateFile);
    const clients = registry.clients;
    const active = clients.filter((c) => c.active !== false);

    const byIndustry: Record<string, number> = {};
    for (const c of clients) {
      byIndustry[c.industry] = (byIndustry[c.industry] ?? 0) + 1;
    }

    const jobs = state ? Object.values(state.jobs) : [];
    const baked = jobs.filter((j) => j.state === 'done').length;
    const failed = jobs.filter((j) => j.state === 'failed').length;
    const pending = active.length - baked - failed;

    const totalPages = jobs.reduce((s, j) => s + (j.pagesBaked ?? 0), 0);
    const totalImages = jobs.reduce((s, j) => s + (j.imagesGenerated ?? 0), 0);
    const totalDurationMs = jobs.reduce((s, j) => s + (j.durationMs ?? 0), 0);

    const failures = jobs
      .filter((j) => j.state === 'failed')
      .map((j) => {
        const c = clients.find((cl) => cl.slug === j.clientSlug);
        return { slug: j.clientSlug, name: c?.name ?? j.clientSlug, error: j.error ?? 'unknown' };
      });

    const doneBakes = jobs.filter((j) => j.state === 'done' && j.bakedAt);
    let oldestBake: PortfolioSummary['oldestBake'] = null;
    let newestBake: PortfolioSummary['newestBake'] = null;
    if (doneBakes.length > 0) {
      doneBakes.sort((a, b) => a.bakedAt!.localeCompare(b.bakedAt!));
      const oldestJob = doneBakes[0]!;
      const newestJob = doneBakes[doneBakes.length - 1]!;
      const oldestAge = Math.floor((Date.now() - new Date(oldestJob.bakedAt!).getTime()) / 86_400_000);
      oldestBake = { slug: oldestJob.clientSlug, ageDays: oldestAge };
      newestBake = { slug: newestJob.clientSlug, bakedAt: newestJob.bakedAt! };
    }

    return {
      agency: registry.agency.name,
      generatedAt: new Date().toISOString(),
      totalClients: clients.length,
      activeClients: active.length,
      baked,
      failed,
      pending: Math.max(0, pending),
      totalPages,
      totalImages,
      totalDurationMs,
      avgPagesPerClient: baked === 0 ? 0 : Math.round(totalPages / baked),
      byIndustry,
      failures,
      oldestBake,
      newestBake,
    };
  }

  /**
   * Markdown raport — gotowy do wklejenia w Slack/email.
   */
  markdown(stateFile?: string): string {
    const summary = this.summary(stateFile);
    const lines: string[] = [];
    lines.push(`# ${summary.agency} — portfolio dashboard`);
    lines.push(`**Generated:** ${summary.generatedAt.slice(0, 19).replace('T', ' ')}`);
    lines.push('');
    lines.push('## Status');
    lines.push('');
    lines.push(`| Metric | Value |`);
    lines.push(`|--------|-------|`);
    lines.push(`| Total clients | ${summary.totalClients} |`);
    lines.push(`| Active | ${summary.activeClients} |`);
    lines.push(`| ✓ Baked | **${summary.baked}** |`);
    lines.push(`| ✗ Failed | ${summary.failed} |`);
    lines.push(`| ⏳ Pending | ${summary.pending} |`);
    lines.push(`| Total pages baked | ${summary.totalPages} |`);
    lines.push(`| Total alt-texts generated | ${summary.totalImages} |`);
    lines.push(`| Avg pages/client | ${summary.avgPagesPerClient} |`);
    lines.push(`| Total bake time | ${Math.round(summary.totalDurationMs / 1000 / 60)} min |`);
    lines.push('');

    lines.push('## By industry');
    lines.push('');
    lines.push(`| Industry | Count |`);
    lines.push(`|----------|-------|`);
    for (const [ind, count] of Object.entries(summary.byIndustry).sort((a, b) => b[1] - a[1])) {
      lines.push(`| ${ind} | ${count} |`);
    }
    lines.push('');

    if (summary.oldestBake) {
      lines.push(`## Refresh status`);
      lines.push('');
      lines.push(`- **Oldest bake:** ${summary.oldestBake.slug} (${summary.oldestBake.ageDays} dni temu)`);
      lines.push(`- **Newest bake:** ${summary.newestBake!.slug} (${summary.newestBake!.bakedAt.slice(0, 10)})`);
      if (summary.oldestBake.ageDays > 90) {
        lines.push(`- ⚠️ **Action needed:** ${summary.oldestBake.slug} przekroczył 90-dniowy próg refresh`);
      }
      lines.push('');
    }

    if (summary.failures.length > 0) {
      lines.push('## ✗ Failures');
      lines.push('');
      for (const f of summary.failures) {
        lines.push(`- **${f.slug}** (${f.name}) — ${f.error.slice(0, 120)}`);
      }
      lines.push('');
    }

    // Per-client status table
    const registry = this.registry.load();
    lines.push('## All clients');
    lines.push('');
    lines.push(`| Slug | Name | Industry | Site | Status | Last bake |`);
    lines.push(`|------|------|----------|------|--------|-----------|`);
    const state = this.loadState(stateFile);
    for (const c of registry.clients.sort((a, b) => a.slug.localeCompare(b.slug))) {
      const job = state?.jobs[c.slug];
      const statusEmoji = job?.state === 'done' ? '✓' : job?.state === 'failed' ? '✗' : c.active === false ? '⊘' : '⏳';
      const lastBake = job?.bakedAt?.slice(0, 10) ?? '—';
      lines.push(`| ${c.slug} | ${c.name} | ${c.industry} | ${c.siteUrl.replace(/^https?:\/\//, '')} | ${statusEmoji} ${job?.state ?? 'pending'} | ${lastBake} |`);
    }

    return lines.join('\n');
  }

  /**
   * HTML dashboard — single-file, brak deps.
   */
  html(stateFile?: string): string {
    const summary = this.summary(stateFile);
    const registry = this.registry.load();
    const state = this.loadState(stateFile);

    const clientRows = registry.clients
      .sort((a, b) => a.slug.localeCompare(b.slug))
      .map((c) => {
        const job = state?.jobs[c.slug];
        const status = job?.state ?? 'pending';
        const statusClass = status === 'done' ? 'ok' : status === 'failed' ? 'fail' : 'pending';
        const lastBake = job?.bakedAt?.slice(0, 10) ?? '—';
        const pages = job?.pagesBaked ?? '—';
        return `<tr><td>${escapeHtml(c.slug)}</td><td>${escapeHtml(c.name)}</td><td><span class="industry">${escapeHtml(c.industry)}</span></td><td><a href="${escapeHtml(c.siteUrl)}" target="_blank">${escapeHtml(c.siteUrl.replace(/^https?:\/\//, ''))}</a></td><td><span class="status ${statusClass}">${status}</span></td><td>${pages}</td><td>${lastBake}</td></tr>`;
      })
      .join('\n      ');

    const industryRows = Object.entries(summary.byIndustry)
      .sort((a, b) => b[1] - a[1])
      .map(([ind, count]) => `<tr><td>${escapeHtml(ind)}</td><td>${count}</td></tr>`)
      .join('\n      ');

    const failureBlocks = summary.failures
      .map((f) => `<div class="failure"><strong>${escapeHtml(f.slug)}</strong> (${escapeHtml(f.name)})<br><code>${escapeHtml(f.error.slice(0, 200))}</code></div>`)
      .join('\n');

    return `<!DOCTYPE html>
<html lang="pl">
<head>
<meta charset="UTF-8">
<title>${escapeHtml(summary.agency)} — Portfolio Dashboard</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, system-ui, sans-serif; padding: 32px; background: #0a0a0a; color: #e5e5e5; }
h1 { font-size: 28px; margin-bottom: 4px; }
.meta { color: #888; font-size: 13px; margin-bottom: 32px; }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; margin-bottom: 40px; }
.card { background: #1a1a1a; padding: 20px; border-radius: 8px; border: 1px solid #2a2a2a; }
.card .label { font-size: 12px; color: #888; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px; }
.card .value { font-size: 32px; font-weight: 600; color: #fff; }
.card.ok .value { color: #4ade80; }
.card.fail .value { color: #f87171; }
.card.pending .value { color: #fbbf24; }
h2 { font-size: 20px; margin: 32px 0 16px; }
table { width: 100%; border-collapse: collapse; background: #1a1a1a; border-radius: 8px; overflow: hidden; }
th, td { padding: 12px 16px; text-align: left; border-bottom: 1px solid #2a2a2a; font-size: 13px; }
th { background: #0f0f0f; color: #888; text-transform: uppercase; font-size: 11px; letter-spacing: 1px; }
.status { padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; text-transform: uppercase; }
.status.ok { background: #064e3b; color: #6ee7b7; }
.status.fail { background: #7f1d1d; color: #fca5a5; }
.status.pending { background: #78350f; color: #fcd34d; }
.industry { background: #1e3a8a; color: #93c5fd; padding: 2px 8px; border-radius: 4px; font-size: 11px; }
a { color: #60a5fa; text-decoration: none; }
.failure { background: #1f0606; border-left: 3px solid #f87171; padding: 12px 16px; margin-bottom: 8px; border-radius: 4px; }
.failure code { display: block; margin-top: 4px; color: #fca5a5; font-size: 11px; }
.two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
@media (max-width: 768px) { .two-col { grid-template-columns: 1fr; } }
</style>
</head>
<body>
<h1>${escapeHtml(summary.agency)}</h1>
<div class="meta">Portfolio dashboard · ${summary.generatedAt.slice(0, 19).replace('T', ' ')}</div>

<div class="grid">
  <div class="card"><div class="label">Total clients</div><div class="value">${summary.totalClients}</div></div>
  <div class="card"><div class="label">Active</div><div class="value">${summary.activeClients}</div></div>
  <div class="card ok"><div class="label">✓ Baked</div><div class="value">${summary.baked}</div></div>
  <div class="card fail"><div class="label">✗ Failed</div><div class="value">${summary.failed}</div></div>
  <div class="card pending"><div class="label">⏳ Pending</div><div class="value">${summary.pending}</div></div>
  <div class="card"><div class="label">Pages baked</div><div class="value">${summary.totalPages.toLocaleString()}</div></div>
  <div class="card"><div class="label">Alt-texts</div><div class="value">${summary.totalImages.toLocaleString()}</div></div>
  <div class="card"><div class="label">Total time</div><div class="value">${Math.round(summary.totalDurationMs / 1000 / 60)}m</div></div>
</div>

<div class="two-col">
<div>
<h2>By industry</h2>
<table>
  <thead><tr><th>Industry</th><th>Clients</th></tr></thead>
  <tbody>${industryRows}</tbody>
</table>
</div>
<div>
<h2>Refresh status</h2>
<table>
  <thead><tr><th>Metric</th><th>Value</th></tr></thead>
  <tbody>
    <tr><td>Oldest bake</td><td>${summary.oldestBake ? `${escapeHtml(summary.oldestBake.slug)} (${summary.oldestBake.ageDays}d)` : '—'}</td></tr>
    <tr><td>Newest bake</td><td>${summary.newestBake ? `${escapeHtml(summary.newestBake.slug)} (${summary.newestBake.bakedAt.slice(0, 10)})` : '—'}</td></tr>
    <tr><td>Avg pages/client</td><td>${summary.avgPagesPerClient}</td></tr>
  </tbody>
</table>
</div>
</div>

${summary.failures.length > 0 ? `<h2>✗ Failures</h2>\n${failureBlocks}` : ''}

<h2>All clients (${registry.clients.length})</h2>
<table>
  <thead><tr><th>Slug</th><th>Name</th><th>Industry</th><th>Site</th><th>Status</th><th>Pages</th><th>Last bake</th></tr></thead>
  <tbody>
      ${clientRows}
  </tbody>
</table>

</body>
</html>`;
  }

  private loadState(stateFile?: string): BakeStateFile | null {
    const path = stateFile ?? join(this.registry.portfolioDir(), '.bake-state.json');
    if (!existsSync(path)) return null;
    try {
      return JSON.parse(readFileSync(path, 'utf-8')) as BakeStateFile;
    } catch {
      return null;
    }
  }
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
