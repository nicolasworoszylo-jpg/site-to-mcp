/**
 * Deployment helpers — push baked content do 100+ klientów.
 *
 * Methods:
 *   - rsync — over SSH (najszybsze)
 *   - git — commit + push do repo klienta
 *   - sftp — fallback (zero deps)
 *   - manual — wypisz instrukcje (klient sam wgra)
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import type { Registry } from './registry.js';
import type { ClientEntry } from './types.js';

const execAsync = promisify(exec);

export interface DeployResult {
  client: string;
  method: string;
  ok: boolean;
  error?: string;
  output?: string;
  durationMs: number;
}

export interface BulkDeployResult {
  startedAt: string;
  finishedAt: string;
  total: number;
  succeeded: number;
  failed: number;
  manual: number;
  results: DeployResult[];
}

export class Deployer {
  constructor(
    private registry: Registry,
    private log: (msg: string) => void = (m) => console.log(`[deploy] ${m}`),
  ) {}

  async deployAll(opts: { clientSlugs?: string[]; dryRun?: boolean } = {}): Promise<BulkDeployResult> {
    const startedAt = new Date().toISOString();
    const clients = this.registry.listClients({ active: true });
    const toDeploy = opts.clientSlugs ? clients.filter((c) => opts.clientSlugs!.includes(c.slug)) : clients;

    const results: DeployResult[] = [];
    for (const client of toDeploy) {
      const result = await this.deployOne(client, opts.dryRun ?? false);
      results.push(result);
    }

    return {
      startedAt,
      finishedAt: new Date().toISOString(),
      total: toDeploy.length,
      succeeded: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok && r.method !== 'manual').length,
      manual: results.filter((r) => r.method === 'manual').length,
      results,
    };
  }

  async deployOne(client: ClientEntry, dryRun = false): Promise<DeployResult> {
    const start = Date.now();
    const bakeDir = this.registry.bakeDirFor(client.slug);

    if (!existsSync(bakeDir)) {
      return {
        client: client.slug,
        method: 'none',
        ok: false,
        error: `Bake dir doesn't exist: ${bakeDir}`,
        durationMs: Date.now() - start,
      };
    }

    const method = client.deploy?.method ?? 'manual';
    this.log(`  ${client.slug} via ${method}${dryRun ? ' (dry-run)' : ''}`);

    try {
      switch (method) {
        case 'rsync':
          return await this.rsync(client, bakeDir, dryRun, start);
        case 'git':
          return await this.git(client, bakeDir, dryRun, start);
        case 'sftp':
          return await this.sftp(client, bakeDir, dryRun, start);
        case 'manual':
        default:
          return this.manual(client, bakeDir, start);
      }
    } catch (err) {
      return {
        client: client.slug,
        method,
        ok: false,
        error: String(err),
        durationMs: Date.now() - start,
      };
    }
  }

  private async rsync(client: ClientEntry, bakeDir: string, dryRun: boolean, start: number): Promise<DeployResult> {
    const target = client.deploy?.target;
    if (!target) {
      return { client: client.slug, method: 'rsync', ok: false, error: 'Missing deploy.target', durationMs: Date.now() - start };
    }
    const dryFlag = dryRun ? '--dry-run' : '';
    const cmd = `rsync -avz --delete ${dryFlag} ${bakeDir}/ ${target}`;
    const { stdout, stderr } = await execAsync(cmd, { timeout: 600_000 });
    return {
      client: client.slug,
      method: 'rsync',
      ok: true,
      output: (stdout + stderr).slice(0, 500),
      durationMs: Date.now() - start,
    };
  }

  private async git(client: ClientEntry, bakeDir: string, dryRun: boolean, start: number): Promise<DeployResult> {
    const target = client.deploy?.target; // path do repo
    const branch = client.deploy?.gitBranch ?? 'main';
    if (!target) {
      return { client: client.slug, method: 'git', ok: false, error: 'Missing deploy.target (path do repo)', durationMs: Date.now() - start };
    }
    if (!existsSync(target)) {
      return { client: client.slug, method: 'git', ok: false, error: `Repo path doesn't exist: ${target}`, durationMs: Date.now() - start };
    }
    // Skopiuj bake do repo/public/seo-bake albo gdziekolwiek user wskazał
    const destInRepo = `${target}/public/seo-bake`;
    if (dryRun) {
      return {
        client: client.slug,
        method: 'git',
        ok: true,
        output: `[dry-run] Would: rsync ${bakeDir}/ → ${destInRepo}/ then git commit + push origin ${branch}`,
        durationMs: Date.now() - start,
      };
    }
    await execAsync(`mkdir -p ${destInRepo} && rsync -avz --delete ${bakeDir}/ ${destInRepo}/`);
    const commitMsg = `chore(seo-bake): refresh ${new Date().toISOString().slice(0, 10)}`;
    const { stdout } = await execAsync(
      `cd ${target} && git add public/seo-bake && git commit -m "${commitMsg}" && git push origin ${branch}`,
      { timeout: 300_000 },
    );
    return {
      client: client.slug,
      method: 'git',
      ok: true,
      output: stdout.slice(0, 500),
      durationMs: Date.now() - start,
    };
  }

  private async sftp(_client: ClientEntry, _bakeDir: string, _dryRun: boolean, start: number): Promise<DeployResult> {
    // Placeholder: pełen SFTP wymagałby ssh2-sftp-client dep
    return {
      client: _client.slug,
      method: 'sftp',
      ok: false,
      error: 'SFTP not implemented in v1 — use rsync over SSH or manual',
      durationMs: Date.now() - start,
    };
  }

  private manual(client: ClientEntry, bakeDir: string, start: number): DeployResult {
    return {
      client: client.slug,
      method: 'manual',
      ok: true,
      output: `Manual deploy needed:
  Bake dir: ${bakeDir}
  Target site: ${client.siteUrl}
  Notes: ${client.deploy?.notes ?? '(none)'}
  Instructions:
    1. Upload contents of ${bakeDir} to client's public/seo-bake/ (or wp-content/uploads/seo-bake/ for WP)
    2. Verify endpoints: ${client.siteUrl}/llms.txt, ${client.siteUrl}/.well-known/mcp.json
    3. Notify client of successful deploy.`,
      durationMs: Date.now() - start,
    };
  }
}
