#!/usr/bin/env node
/**
 * Smoke test dla autopilot.
 *
 * Sprawdza że:
 * - Storage (SQLite) działa
 * - Wszystkie 15 modułów ładują się
 * - Factory tworzy instance bez crash
 * - CLI binary jest executable
 * - Health check zwraca strukturę
 *
 * Nie wymaga sieci ani Ollama (modules zwracają graceful failures).
 */

import { unlinkSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEST_DB = join(__dirname, 'test-autopilot.db');

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
  console.log('autopilot smoke test\n');

  // Cleanup
  if (existsSync(TEST_DB)) unlinkSync(TEST_DB);

  // === Test 1: imports ===
  console.log('[1] Imports');
  const mod = await import('../dist/index.js');
  assert(typeof mod.createAutopilot === 'function', 'createAutopilot exported');
  assert(typeof mod.AutopilotStorage === 'function', 'AutopilotStorage exported');
  assert(typeof mod.OllamaClient === 'function', 'OllamaClient exported');
  assert(typeof mod.cosineSimilarity === 'function', 'cosineSimilarity exported');
  assert(typeof mod.generateLaunchAgentPlist === 'function', 'generateLaunchAgentPlist exported');
  assert(typeof mod.Scheduler === 'function', 'Scheduler exported');
  assert(typeof mod.generateWeeklyReport === 'function', 'generateWeeklyReport exported');

  // === Test 2: 15 modules exported ===
  console.log('\n[2] 15 modules');
  const moduleNames = [
    'KeywordResearchModule', 'RankTrackerModule', 'AltGeneratorModule',
    'ContentRewriterModule', 'InternalLinkingModule', 'BrokenLinksModule',
    'BacklinkMonitorModule', 'CompetitorTrackerModule', 'ContentRefreshModule',
    'GscSyncModule', 'PsiMonitorModule', 'IndexNowPushModule',
    'HreflangValidatorModule', 'CanonicalValidatorModule', 'LighthouseAuditModule',
  ];
  for (const name of moduleNames) {
    assert(typeof mod[name] === 'function', `${name} exported`);
  }

  // === Test 3: Storage ===
  console.log('\n[3] Storage SQLite');
  const storage = new mod.AutopilotStorage(TEST_DB);
  storage.insertKeyword({ keyword: 'test kw', language: 'pl', source: 'manual', capturedAt: new Date().toISOString() });
  const kws = storage.listKeywords('pl');
  assert(kws.length === 1, `keywords stored (got ${kws.length})`);
  assert(kws[0].keyword === 'test kw', 'keyword content correct');

  storage.logRun({
    module: 'keyword-research',
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: 100,
    ok: true,
    itemsProcessed: 5,
    itemsChanged: 5,
    summary: 'test run',
  });
  const runs = storage.lastRuns();
  assert(runs.length === 1, 'run logged');
  assert(runs[0].module === 'keyword-research', 'module name correct');

  // === Test 4: Embeddings ===
  console.log('\n[4] Embeddings storage');
  storage.upsertEmbedding('https://test.com/a', [0.1, 0.2, 0.3], 'hash1', 'test-model');
  storage.upsertEmbedding('https://test.com/b', [0.15, 0.25, 0.35], 'hash2', 'test-model');
  const embs = storage.listEmbeddings();
  assert(embs.length === 2, `embeddings stored (got ${embs.length})`);
  assert(embs[0].embedding.length === 3, 'embedding length preserved');

  // === Test 5: Cosine similarity ===
  console.log('\n[5] Cosine similarity');
  assert(Math.abs(mod.cosineSimilarity([1, 0, 0], [1, 0, 0]) - 1) < 0.001, 'identical = 1');
  assert(Math.abs(mod.cosineSimilarity([1, 0, 0], [0, 1, 0])) < 0.001, 'orthogonal = 0');
  assert(mod.cosineSimilarity([1, 0], [-1, 0]) === -1, 'opposite = -1');

  // === Test 6: Factory creation ===
  console.log('\n[6] Factory');
  const s2mMod = await import('../../core/dist/index.js');
  const s2m = s2mMod.createSiteToMcp({
    siteUrl: 'https://example.com',
    brand: { name: 'Test' },
  });
  const ap = mod.createAutopilot({
    s2m,
    storage: TEST_DB + '.factory',
  });
  assert(ap !== null, 'autopilot created');
  assert(typeof ap.run === 'function', 'ap.run exists');
  assert(typeof ap.healthCheck === 'function', 'ap.healthCheck exists');
  assert(typeof ap.report === 'function', 'ap.report exists');
  assert(Object.keys(ap.modules).length === 16, `16 modules loaded (got ${Object.keys(ap.modules).length})`);
  assert(typeof ap.modules['outreach-generator'] === 'object', 'outreach-generator module loaded');

  // === Test 7: Health check (no network) ===
  console.log('\n[7] Health check');
  const health = await ap.healthCheck();
  assert(typeof health.ollama === 'object', 'health.ollama exists');
  assert(typeof health.google === 'object', 'health.google exists');
  assert(typeof health.bing === 'object', 'health.bing exists');
  assert(health.google.psi === false, 'psi false (no key in test)');

  // === Test 8: Module run (offline failure) ===
  console.log('\n[8] Module graceful failure (offline)');
  const r1 = await ap.run('rank-tracker', { keywords: [], domain: '' });
  assert(r1.ok === false, 'rank-tracker fails gracefully on empty input');
  assert(r1.error !== undefined, 'error message set');

  // === Test 9: Report generation ===
  console.log('\n[9] Report');
  const report = ap.report();
  assert(report.includes('# Autopilot weekly report'), 'report has header');
  assert(report.includes('| Module |'), 'report has activity table');

  // === Test 10: LaunchAgent plist ===
  console.log('\n[10] LaunchAgent plist');
  const plist = mod.generateLaunchAgentPlist({
    label: 'pl.test.foo',
    command: ['/usr/bin/node', 'script.js'],
    intervalSeconds: 3600,
  });
  assert(plist.includes('<?xml'), 'plist is XML');
  assert(plist.includes('<key>Label</key>'), 'plist has Label');
  assert(plist.includes('pl.test.foo'), 'plist has correct label');
  assert(plist.includes('<integer>3600</integer>'), 'plist has interval');

  // === Test 11: Cron expression conversion ===
  console.log('\n[11] Cron conversion');
  assert(mod.toCronExpression('daily 09:00') === '0 9 * * *', 'daily 09:00');
  assert(mod.toCronExpression('weekly sunday') === '0 10 * * 0', 'weekly sunday');
  assert(mod.toCronExpression('0 5 * * *') === '0 5 * * *', 'passthrough cron');

  ap.close();
  storage.close();
  if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
  if (existsSync(TEST_DB + '.factory')) unlinkSync(TEST_DB + '.factory');

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
