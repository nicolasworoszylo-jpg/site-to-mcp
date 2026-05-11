/**
 * Module: IndexNow + Google Indexing API push.
 *
 * Po publish/update strony — wymusza recrawl w Bing (IndexNow, free, no auth)
 * i Google (Indexing API, free, wymaga service account).
 *
 * Effect: indexing 30 minut zamiast 7 dni.
 */

import { readFileSync } from 'node:fs';
import type { Module, ModuleRunResult, AutopilotConfig } from '../types.js';
import type { AutopilotStorage } from '../storage/db.js';

export interface IndexNowPushOpts {
  urls: string[];
  /** Czy pushować do Google Indexing API (wymaga service account) */
  google?: boolean;
  /** Czy pushować do Bing IndexNow (no auth, default true) */
  bing?: boolean;
  /** Host strony (do IndexNow validation) */
  host?: string;
}

export class IndexNowPushModule implements Module<IndexNowPushOpts> {
  name = 'indexnow-push' as const;
  description = 'Bing IndexNow + Google Indexing API ping.';

  constructor(
    private storage: AutopilotStorage,
    private cfg: AutopilotConfig,
  ) {}

  async run(opts?: IndexNowPushOpts): Promise<ModuleRunResult> {
    const startedAt = new Date().toISOString();
    const start = Date.now();
    const o = opts ?? { urls: [] };
    if (!o.urls?.length) return this.fail(startedAt, start, 'Missing urls');

    const pushBing = o.bing !== false;
    const pushGoogle = o.google ?? false;
    let succeeded = 0;
    let failed = 0;

    // ===== BING INDEXNOW =====
    if (pushBing) {
      const key = this.cfg.bing?.indexNowKey;
      if (!key) {
        // Auto-generuje UUID, ale user musi hostować na stronie
        this.storage.logIndexNow('SETUP_NEEDED', 'bing-indexnow', null);
      } else {
        const host = o.host ?? (o.urls[0] ? new URL(o.urls[0]).hostname : '');
        try {
          const res = await fetch('https://api.indexnow.org/IndexNow', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
            body: JSON.stringify({
              host,
              key,
              keyLocation: `https://${host}/${key}.txt`,
              urlList: o.urls,
            }),
            signal: AbortSignal.timeout(15_000),
          });
          for (const url of o.urls) {
            this.storage.logIndexNow(url, 'bing-indexnow', res.status);
          }
          if (res.ok || res.status === 202) succeeded += o.urls.length;
          else failed += o.urls.length;
        } catch {
          failed += o.urls.length;
          for (const url of o.urls) this.storage.logIndexNow(url, 'bing-indexnow', 0);
        }
      }
    }

    // ===== GOOGLE INDEXING API =====
    if (pushGoogle) {
      const keyPath = this.cfg.google?.indexingApiKeyPath;
      if (!keyPath) {
        this.storage.logIndexNow('SETUP_NEEDED', 'google-indexing', null);
      } else {
        try {
          const sa = JSON.parse(readFileSync(keyPath, 'utf-8')) as {
            client_email: string;
            private_key: string;
          };
          const token = await this.googleAccessToken(sa);
          for (const url of o.urls) {
            try {
              const res = await fetch('https://indexing.googleapis.com/v3/urlNotifications:publish', {
                method: 'POST',
                headers: {
                  Authorization: `Bearer ${token}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({ url, type: 'URL_UPDATED' }),
                signal: AbortSignal.timeout(10_000),
              });
              this.storage.logIndexNow(url, 'google-indexing', res.status);
              if (res.ok) succeeded++;
              else failed++;
            } catch {
              failed++;
              this.storage.logIndexNow(url, 'google-indexing', 0);
            }
          }
        } catch (err) {
          return this.fail(startedAt, start, `Google service account load failed: ${err}`);
        }
      }
    }

    const finishedAt = new Date().toISOString();
    const result: ModuleRunResult = {
      module: 'indexnow-push',
      startedAt,
      finishedAt,
      durationMs: Date.now() - start,
      ok: true,
      itemsProcessed: succeeded + failed,
      itemsChanged: succeeded,
      summary: `Pushed ${succeeded} URLs (${failed} failed)`,
      data: { urls: o.urls },
    };
    this.storage.logRun(result);
    return result;
  }

  /**
   * Generuje OAuth access token dla Google Indexing API.
   * Service account JWT → token endpoint.
   */
  private async googleAccessToken(sa: { client_email: string; private_key: string }): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: 'RS256', typ: 'JWT' };
    const claim = {
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/indexing',
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

  private fail(startedAt: string, start: number, error: string): ModuleRunResult {
    const finishedAt = new Date().toISOString();
    const result: ModuleRunResult = {
      module: 'indexnow-push',
      startedAt,
      finishedAt,
      durationMs: Date.now() - start,
      ok: false,
      itemsProcessed: 0,
      error,
    };
    this.storage.logRun(result);
    return result;
  }
}
