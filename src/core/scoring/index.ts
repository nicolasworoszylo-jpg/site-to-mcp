/**
 * Scoring — agreguje audit findings w score A-F (jak agentic-seo Osmani'ego).
 *
 * Per-layer scores są już w AuditReport.scores. Tu liczymy:
 *   - overall letter grade (A+ → F)
 *   - kategoryzacja "ready for AI / needs work / not ready"
 *   - CI/CD threshold checking
 */

import type { AuditReport, Finding } from '../../types/index.js';

export type ScoreLetter = 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';

export interface ScoringResult {
  overall: number;
  letter: ScoreLetter;
  category: 'ready' | 'needs_work' | 'not_ready';
  failed: Finding[];
  warnings: Finding[];
  passed: Finding[];
  recommendations: string[];
}

export function scoreLetter(score: number): ScoreLetter {
  if (score >= 95) return 'A+';
  if (score >= 85) return 'A';
  if (score >= 70) return 'B';
  if (score >= 55) return 'C';
  if (score >= 40) return 'D';
  return 'F';
}

export function computeOverallScore(report: AuditReport): ScoringResult {
  const overall = report.scores.overall;
  const letter = scoreLetter(overall);
  const category = overall >= 70 ? 'ready' : overall >= 40 ? 'needs_work' : 'not_ready';

  const failed = report.findings.filter((f) => f.status === 'fail');
  const warnings = report.findings.filter((f) => f.status === 'warning');
  const passed = report.findings.filter((f) => f.status === 'pass');

  const recommendations = [...failed, ...warnings]
    .sort((a, b) => (b.impact ?? 0) - (a.impact ?? 0))
    .slice(0, 10)
    .map((f) => `[${f.severity.toUpperCase()}] ${f.title} — ${f.recommendation ?? f.detail}`);

  return { overall, letter, category, failed, warnings, passed, recommendations };
}
