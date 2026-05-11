/**
 * Module: Google Search Console Sync.
 *
 * Free: 50k req/dzień. Wymaga OAuth jednorazowy.
 * Pobiera impressions, clicks, queries, position per page.
 *
 * Stub-friendly: jeśli brak credentials → log "setup needed" w storage.
 */

import { readFileSync } from 'node:fs';
import type { Module, ModuleRunResult, AutopilotConfig, GscRecord } from '../types.js';
import type { AutopilotStorage } from '../storage/db.js';

export interface GscSyncOpts {
  /** Verified property w GSC (np. https://example.com/) */
  siteUrl: string;
  /** Date range — ostatnich N dni (default 28) */
  daysBack?: number;
  /** Dimension: page, query, page+query (default page+query) */
  dimensions?: string[];
}

export class GscSyncModule implements Module<GscSyncOpts> {
  name = 'gsc-sync' as const;
  description = 'Google Search Console queries + clicks sync (free).';
  requires = ['google.searchConsoleAuth'];

  constructor(
    private storage: AutopilotStorage,
    private cfg: AutopilotConfig,
  ) {}

  async run(opts?: GscSyncOpts): Promise<ModuleRunResult> {
    const startedAt = new Date().toISOString();
    const start = Date.now();
    const o = opts ?? { siteUrl: '' };
    if (!o.siteUrl) return this.fail(startedAt, start, 'Missing siteUrl');

    const credPath = this.cfg.google?.searchConsoleAuth;
    if (!credPath) {
      this.storage.logRun({
        module: 'gsc-sync',
        startedAt,
        finishedAt: new Date().toISOString(),
        durationMs: Date.now() - start,
        ok: false,
        itemsProcessed: 0,
        error: 'SETUP_NEEDED: Configure google.searchConsoleAuth in AutopilotConfig',
        summary: 'GSC sync requires one-time OAuth setup (free)',
      });
      return this.fail(startedAt, start, 'SETUP_NEEDED: google.searchConsoleAuth');
    }

    const daysBack = o.daysBack ?? 28;
    const dimensions = o.dimensions ?? ['page', 'query'];
    const endDate = new Date().toISOString().slice(0, 10);
    const startDate = new Date(Date.now() - daysBack * 86_400_000).toISOString().slice(0, 10);

    try {
      // Same auth pattern jako indexnow-push.ts — service account JWT albo OAuth refresh
      const sa = JSON.parse(readFileSync(credPath, 'utf-8')) as {
        client_email?: string;
        private_key?: string;
        installed?: { client_id: string; client_secret: string };
        refresh_token?: string;
      };

      let token: string;
      if (sa.client_email && sa.private_key) {
        token = await this.serviceAccountToken(sa as { client_email: string; private_key: string });
      } else if (sa.refresh_token && sa.installed) {
        token = await this.refreshOauthToken(sa.installed, sa.refresh_token);
      } else {
        return this.fail(startedAt, start, 'Invalid credentials format');
      }

      const apiUrl = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(o.siteUrl)}/searchAnalytics/query`;
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startDate,
          endDate,
          dimensions,
          rowLimit: 5000,
        }),
      });
      if (!res.ok) {
        return this.fail(startedAt, start, `GSC API ${res.status}: ${await res.text()}`);
      }
      const json = (await res.json()) as { rows?: Array<{ keys: string[]; clicks: number; impressions: number; ctr: number; position: number }> };
      const rows = json.rows ?? [];

      for (const row of rows) {
        const rec: GscRecord = {
          page: row.keys[0] ?? '',
          query: row.keys[1] ?? '',
          clicks: row.clicks,
          impressions: row.impressions,
          ctr: row.ctr,
          position: row.position,
          date: endDate,
        };
        this.storage.insertGscRow(rec);
      }

      const finishedAt = new Date().toISOString();
      const result: ModuleRunResult = {
        module: 'gsc-sync', startedAt, finishedAt,
        durationMs: Date.now() - start, ok: true,
        itemsProcessed: rows.length, itemsChanged: rows.length,
        summary: `Synced ${rows.length} GSC rows (${startDate} to ${endDate})`,
        data: { rowCount: rows.length },
      };
      this.storage.logRun(result);
      return result;
    } catch (err) {
      return this.fail(startedAt, start, String(err));
    }
  }

  private async serviceAccountToken(sa: { client_email: string; private_key: string }): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: 'RS256', typ: 'JWT' };
    const claim = {
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/webmasters.readonly',
      aud: 'https://oauth2.googleapis.com/token',
      exp: now + 3600,
      iat: now,
    };
    const enc = (obj: object) => Buffer.from(JSON.stringify(obj)).toString('base64url');
    const signingInput = `${enc(header)}.${enc(claim)}`;
    const crypto = await import('node:crypto');
    const signer = crypto.createSign('RSA-SHA256');
    signer.update(signingInput);
    const signature = signer.sign(sa.private_key).toString('base64url');
    const jwt = `${signingInput}.${signature}`;

    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
    });
    if (!res.ok) throw new Error(`Token exchange failed: ${res.status}`);
    const json = (await res.json()) as { access_token: string };
    return json.access_token;
  }

  private async refreshOauthToken(installed: { client_id: string; client_secret: string }, refreshToken: string): Promise<string> {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: installed.client_id,
        client_secret: installed.client_secret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }).toString(),
    });
    if (!res.ok) throw new Error(`OAuth refresh failed: ${res.status}`);
    const json = (await res.json()) as { access_token: string };
    return json.access_token;
  }

  private fail(startedAt: string, start: number, error: string): ModuleRunResult {
    const finishedAt = new Date().toISOString();
    const result: ModuleRunResult = {
      module: 'gsc-sync', startedAt, finishedAt,
      durationMs: Date.now() - start, ok: false, itemsProcessed: 0, error,
    };
    this.storage.logRun(result);
    return result;
  }
}
