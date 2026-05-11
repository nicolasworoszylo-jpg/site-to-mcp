/**
 * SQLite storage — lokalna baza danych dla wszystkich Autopilot modułów.
 *
 * Filozofia: zero cloud, zero recurring cost. Jeden plik DB.
 * Wszystkie inserts są idempotentne (UNIQUE constraints) — moduły mogą być
 * uruchamiane wielokrotnie bez duplikatów.
 */

import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type {
  KeywordRecord,
  RankRecord,
  BacklinkRecord,
  AltTextRecord,
  BrokenLinkRecord,
  VitalsRecord,
  GscRecord,
  RefreshSuggestion,
  InternalLinkSuggestion,
  CompetitorPage,
  ModuleRunResult,
} from '../types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export class AutopilotStorage {
  private db: Database.Database;

  constructor(path: string = './autopilot.db') {
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.init();
  }

  private init(): void {
    const schemaPath = join(__dirname, 'schema.sql');
    let schema: string;
    try {
      schema = readFileSync(schemaPath, 'utf-8');
    } catch {
      // fallback: schema embedded path różny w dist
      schema = readFileSync(join(__dirname, '..', '..', 'src', 'storage', 'schema.sql'), 'utf-8');
    }
    this.db.exec(schema);
  }

  // ========================================================================
  // RUN LOG
  // ========================================================================

  logRun(result: ModuleRunResult): void {
    this.db
      .prepare(
        `INSERT INTO run_log (module, started_at, finished_at, duration_ms, ok, items_processed, items_changed, error, summary, data_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        result.module,
        result.startedAt,
        result.finishedAt,
        result.durationMs,
        result.ok ? 1 : 0,
        result.itemsProcessed,
        result.itemsChanged ?? 0,
        result.error ?? null,
        result.summary ?? null,
        result.data ? JSON.stringify(result.data) : null,
      );
  }

  lastRuns(module?: string, limit = 20): ModuleRunResult[] {
    const rows = module
      ? this.db
          .prepare(`SELECT * FROM run_log WHERE module = ? ORDER BY started_at DESC LIMIT ?`)
          .all(module, limit)
      : this.db.prepare(`SELECT * FROM run_log ORDER BY started_at DESC LIMIT ?`).all(limit);
    return rows.map((r) => {
      const row = r as {
        module: string;
        started_at: string;
        finished_at: string;
        duration_ms: number;
        ok: number;
        items_processed: number;
        items_changed: number;
        error: string | null;
        summary: string | null;
        data_json: string | null;
      };
      return {
        module: row.module as ModuleRunResult['module'],
        startedAt: row.started_at,
        finishedAt: row.finished_at,
        durationMs: row.duration_ms,
        ok: row.ok === 1,
        itemsProcessed: row.items_processed,
        itemsChanged: row.items_changed,
        ...(row.error ? { error: row.error } : {}),
        ...(row.summary ? { summary: row.summary } : {}),
        ...(row.data_json ? { data: JSON.parse(row.data_json) } : {}),
      };
    });
  }

  // ========================================================================
  // KEYWORDS
  // ========================================================================

  insertKeyword(rec: KeywordRecord): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO keywords (keyword, language, source, parent_keyword, captured_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(rec.keyword, rec.language, rec.source, rec.parentKeyword ?? null, rec.capturedAt);
  }

  listKeywords(language?: string): KeywordRecord[] {
    const rows = language
      ? this.db.prepare(`SELECT * FROM keywords WHERE language = ? ORDER BY captured_at DESC`).all(language)
      : this.db.prepare(`SELECT * FROM keywords ORDER BY captured_at DESC`).all();
    return rows.map((r) => {
      const row = r as { keyword: string; language: string; source: string; parent_keyword: string | null; captured_at: string };
      return {
        keyword: row.keyword,
        language: row.language,
        source: row.source as KeywordRecord['source'],
        ...(row.parent_keyword ? { parentKeyword: row.parent_keyword } : {}),
        capturedAt: row.captured_at,
      };
    });
  }

  // ========================================================================
  // RANKS
  // ========================================================================

  insertRank(rec: RankRecord): void {
    this.db
      .prepare(
        `INSERT INTO ranks (keyword, language, domain, position, url, engine, captured_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(rec.keyword, rec.language, rec.domain, rec.position, rec.url ?? null, rec.engine, rec.capturedAt);
  }

  latestRanksForDomain(domain: string): RankRecord[] {
    const rows = this.db
      .prepare(
        `SELECT r1.* FROM ranks r1
         INNER JOIN (
           SELECT keyword, engine, MAX(captured_at) AS mx
           FROM ranks WHERE domain = ? GROUP BY keyword, engine
         ) r2 ON r1.keyword = r2.keyword AND r1.engine = r2.engine AND r1.captured_at = r2.mx
         WHERE r1.domain = ? ORDER BY r1.position ASC`,
      )
      .all(domain, domain);
    return rows.map((r) => {
      const row = r as { keyword: string; language: string; domain: string; position: number | null; url: string | null; engine: string; captured_at: string };
      return {
        keyword: row.keyword,
        language: row.language,
        domain: row.domain,
        position: row.position,
        ...(row.url ? { url: row.url } : {}),
        engine: row.engine as RankRecord['engine'],
        capturedAt: row.captured_at,
      };
    });
  }

  // ========================================================================
  // BACKLINKS
  // ========================================================================

  upsertBacklink(rec: BacklinkRecord): void {
    this.db
      .prepare(
        `INSERT INTO backlinks (source_url, source_domain, target_url, anchor_text, first_seen_at, last_seen_at, source)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(source_url, target_url) DO UPDATE SET last_seen_at = excluded.last_seen_at`,
      )
      .run(rec.sourceUrl, rec.sourceDomain, rec.targetUrl, rec.anchorText ?? null, rec.firstSeenAt, rec.lastSeenAt, rec.source);
  }

  backlinksForTarget(targetUrl: string): BacklinkRecord[] {
    return this.db
      .prepare(`SELECT * FROM backlinks WHERE target_url = ? ORDER BY last_seen_at DESC`)
      .all(targetUrl)
      .map((r) => {
        const row = r as { source_url: string; source_domain: string; target_url: string; anchor_text: string | null; first_seen_at: string; last_seen_at: string; source: string };
        return {
          sourceUrl: row.source_url,
          sourceDomain: row.source_domain,
          targetUrl: row.target_url,
          ...(row.anchor_text ? { anchorText: row.anchor_text } : {}),
          firstSeenAt: row.first_seen_at,
          lastSeenAt: row.last_seen_at,
          source: row.source as BacklinkRecord['source'],
        };
      });
  }

  // ========================================================================
  // ALT TEXTS
  // ========================================================================

  upsertAltText(rec: AltTextRecord): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO alt_texts (image_src, alt_text, page_url, generated_at, model)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(rec.imageSrc, rec.altText, rec.pageUrl, rec.generatedAt, rec.model);
  }

  getAltText(imageSrc: string): AltTextRecord | null {
    const row = this.db.prepare(`SELECT * FROM alt_texts WHERE image_src = ?`).get(imageSrc) as
      | { image_src: string; alt_text: string; page_url: string; generated_at: string; model: string }
      | undefined;
    if (!row) return null;
    return {
      imageSrc: row.image_src,
      altText: row.alt_text,
      pageUrl: row.page_url,
      generatedAt: row.generated_at,
      model: row.model,
    };
  }

  // ========================================================================
  // BROKEN LINKS
  // ========================================================================

  insertBrokenLink(rec: BrokenLinkRecord): void {
    this.db
      .prepare(
        `INSERT INTO broken_links (url, status, found_on_page, detected_at) VALUES (?, ?, ?, ?)`,
      )
      .run(rec.url, rec.status, rec.foundOnPage, rec.detectedAt);
  }

  // ========================================================================
  // VITALS
  // ========================================================================

  insertVitals(rec: VitalsRecord): void {
    this.db
      .prepare(
        `INSERT INTO vitals (url, strategy, lcp, cls, inp, ttfb, captured_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(rec.url, rec.strategy, rec.lcp, rec.cls, rec.inp, rec.ttfb, rec.capturedAt);
  }

  // ========================================================================
  // GSC
  // ========================================================================

  insertGscRow(rec: GscRecord): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO gsc_data (page, query, clicks, impressions, ctr, position, date)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(rec.page, rec.query, rec.clicks, rec.impressions, rec.ctr, rec.position, rec.date);
  }

  // ========================================================================
  // REFRESH SUGGESTIONS
  // ========================================================================

  insertRefreshSuggestion(rec: RefreshSuggestion): void {
    this.db
      .prepare(
        `INSERT INTO refresh_suggestions (url, last_modified, age_days, suggestion, suggested_at) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(rec.url, rec.lastModified, rec.ageDays, rec.suggestion, rec.suggestedAt);
  }

  // ========================================================================
  // INTERNAL LINKS
  // ========================================================================

  upsertInternalLinkSuggestion(rec: InternalLinkSuggestion): void {
    this.db
      .prepare(
        `INSERT INTO internal_link_suggestions (from_page, to_page, similarity, proposed_anchor, suggested_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(from_page, to_page) DO UPDATE SET similarity = excluded.similarity, proposed_anchor = excluded.proposed_anchor, suggested_at = excluded.suggested_at`,
      )
      .run(rec.fromPage, rec.toPage, rec.similarity, rec.proposedAnchor, rec.suggestedAt);
  }

  // ========================================================================
  // COMPETITORS
  // ========================================================================

  insertCompetitorPage(rec: CompetitorPage): void {
    this.db
      .prepare(
        `INSERT INTO competitor_pages (domain, url, title, word_count, schema_types_json, captured_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        rec.domain,
        rec.url,
        rec.title ?? null,
        rec.wordCount ?? null,
        rec.schemaTypes ? JSON.stringify(rec.schemaTypes) : null,
        rec.capturedAt,
      );
  }

  // ========================================================================
  // EMBEDDINGS
  // ========================================================================

  upsertEmbedding(url: string, embedding: number[], textHash: string, model: string): void {
    const buf = Buffer.from(new Float32Array(embedding).buffer);
    this.db
      .prepare(
        `INSERT INTO embeddings (url, embedding, text_hash, model, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(url) DO UPDATE SET embedding = excluded.embedding, text_hash = excluded.text_hash, updated_at = excluded.updated_at`,
      )
      .run(url, buf, textHash, model, new Date().toISOString());
  }

  listEmbeddings(): Array<{ url: string; embedding: number[]; textHash: string }> {
    return this.db
      .prepare(`SELECT url, embedding, text_hash FROM embeddings`)
      .all()
      .map((r) => {
        const row = r as { url: string; embedding: Buffer; text_hash: string };
        const f = new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.length / 4);
        return { url: row.url, embedding: [...f], textHash: row.text_hash };
      });
  }

  // ========================================================================
  // INDEXNOW LOG
  // ========================================================================

  logIndexNow(url: string, engine: string, status: number | null): void {
    this.db
      .prepare(`INSERT INTO index_now_log (url, engine, status, pushed_at) VALUES (?, ?, ?, ?)`)
      .run(url, engine, status, new Date().toISOString());
  }

  close(): void {
    this.db.close();
  }
}
