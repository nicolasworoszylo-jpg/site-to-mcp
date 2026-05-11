/**
 * Clients registry — load/save/manage 100+ klientów w jednym JSON.
 *
 * File format: `wisepeople.clients.json` w root projektu agency.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ClientsRegistry, ClientEntry, Industry } from './types.js';
import { applyIndustryPreset } from './templates.js';

export class Registry {
  constructor(private path: string) {}

  exists(): boolean {
    return existsSync(this.path);
  }

  load(): ClientsRegistry {
    if (!this.exists()) {
      throw new Error(`Registry not found at ${this.path}. Run: s2m-autopilot wp init`);
    }
    const raw = JSON.parse(readFileSync(this.path, 'utf-8')) as ClientsRegistry;
    if (raw.schemaVersion !== 'site-to-mcp-clients/2026-05') {
      throw new Error(`Unsupported schema version: ${raw.schemaVersion}`);
    }
    return raw;
  }

  save(registry: ClientsRegistry): void {
    writeFileSync(this.path, JSON.stringify(registry, null, 2));
  }

  init(agency: { name: string; slug: string; contactEmail?: string }, portfolioDir = './wisepeople-portfolio'): void {
    if (this.exists()) {
      throw new Error(`Registry already exists at ${this.path}`);
    }
    const registry: ClientsRegistry = {
      schemaVersion: 'site-to-mcp-clients/2026-05',
      agency,
      portfolioDir,
      defaults: {
        maxPages: 100,
        concurrency: 3,
      },
      clients: [],
    };
    this.save(registry);
  }

  addClient(entry: ClientEntry): void {
    const registry = this.load();
    if (registry.clients.some((c) => c.slug === entry.slug)) {
      throw new Error(`Client slug "${entry.slug}" already exists`);
    }
    const withDefaults = applyIndustryPreset({ active: true, ...entry });
    registry.clients.push(withDefaults);
    this.save(registry);
  }

  updateClient(slug: string, updates: Partial<ClientEntry>): void {
    const registry = this.load();
    const idx = registry.clients.findIndex((c) => c.slug === slug);
    if (idx < 0) throw new Error(`Client "${slug}" not found`);
    registry.clients[idx] = { ...registry.clients[idx]!, ...updates };
    this.save(registry);
  }

  removeClient(slug: string): void {
    const registry = this.load();
    registry.clients = registry.clients.filter((c) => c.slug !== slug);
    this.save(registry);
  }

  getClient(slug: string): ClientEntry | null {
    const registry = this.load();
    return registry.clients.find((c) => c.slug === slug) ?? null;
  }

  listClients(filter?: { industry?: Industry; active?: boolean; tag?: string }): ClientEntry[] {
    const registry = this.load();
    let list = registry.clients;
    if (filter?.industry) list = list.filter((c) => c.industry === filter.industry);
    if (filter?.active !== undefined) list = list.filter((c) => (c.active ?? true) === filter.active);
    if (filter?.tag) list = list.filter((c) => (c.tags ?? []).includes(filter.tag!));
    return list;
  }

  /**
   * Path do per-client bake folder.
   */
  bakeDirFor(slug: string): string {
    const registry = this.load();
    return resolve(registry.portfolioDir, slug, 'seo-bake');
  }

  portfolioDir(): string {
    return resolve(this.load().portfolioDir);
  }
}

export function loadRegistry(path: string = 'wisepeople.clients.json'): Registry {
  return new Registry(resolve(path));
}
