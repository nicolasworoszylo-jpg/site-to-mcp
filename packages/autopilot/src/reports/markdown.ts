/**
 * Markdown report aggregator.
 *
 * Czyta historię z SQLite, generuje weekly/monthly raport markdown.
 * Gotowy do wklejenia w Slack/Notion/Email.
 */

import type { AutopilotStorage } from '../storage/db.js';

export interface ReportOptions {
  storage: AutopilotStorage;
  /** Period start (ISO) */
  since?: string;
}

export function generateWeeklyReport(opts: ReportOptions): string {
  const { storage } = opts;
  const since = opts.since ?? new Date(Date.now() - 7 * 86_400_000).toISOString();

  const runs = storage.lastRuns(undefined, 200).filter((r) => r.startedAt >= since);
  const byModule = new Map<string, { runs: number; ok: number; failed: number; itemsProcessed: number; itemsChanged: number; durations: number[] }>();
  for (const r of runs) {
    const m = byModule.get(r.module) ?? { runs: 0, ok: 0, failed: 0, itemsProcessed: 0, itemsChanged: 0, durations: [] };
    m.runs++;
    if (r.ok) m.ok++;
    else m.failed++;
    m.itemsProcessed += r.itemsProcessed;
    m.itemsChanged += r.itemsChanged ?? 0;
    m.durations.push(r.durationMs);
    byModule.set(r.module, m);
  }

  const lines: string[] = [];
  lines.push(`# Autopilot weekly report`);
  lines.push(`**Period:** ${since.slice(0, 10)} → ${new Date().toISOString().slice(0, 10)}`);
  lines.push('');
  lines.push(`## Module activity`);
  lines.push('');
  lines.push('| Module | Runs | OK | Failed | Items | Changed | Avg ms |');
  lines.push('|--------|------|----|----|--------|---------|--------|');
  for (const [name, m] of byModule) {
    const avg = m.durations.length ? Math.round(m.durations.reduce((a, b) => a + b, 0) / m.durations.length) : 0;
    lines.push(`| ${name} | ${m.runs} | ${m.ok} | ${m.failed} | ${m.itemsProcessed} | ${m.itemsChanged} | ${avg} |`);
  }
  lines.push('');

  // Recent failures
  const failures = runs.filter((r) => !r.ok).slice(0, 10);
  if (failures.length > 0) {
    lines.push(`## Recent failures (${failures.length})`);
    lines.push('');
    for (const f of failures) {
      lines.push(`- **${f.module}** @ ${f.startedAt.slice(0, 16)} — ${f.error ?? 'unknown'}`);
    }
    lines.push('');
  }

  // Highlights
  lines.push(`## Highlights`);
  lines.push('');
  const totalItems = runs.reduce((s, r) => s + r.itemsProcessed, 0);
  const totalChanged = runs.reduce((s, r) => s + (r.itemsChanged ?? 0), 0);
  lines.push(`- Total items processed: **${totalItems}**`);
  lines.push(`- Total items changed/produced: **${totalChanged}**`);
  lines.push(`- Total runs: **${runs.length}**`);
  lines.push(`- Success rate: **${runs.length ? Math.round((runs.filter((r) => r.ok).length / runs.length) * 100) : 0}%**`);

  return lines.join('\n');
}
