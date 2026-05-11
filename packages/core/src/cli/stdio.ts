#!/usr/bin/env node
/**
 * s2m-stdio — MCP server STDIO transport.
 *
 * Użycie w Claude Desktop config (~/Library/Application Support/Claude/claude_desktop_config.json):
 *
 *   {
 *     "mcpServers": {
 *       "klient-pl": {
 *         "command": "npx",
 *         "args": ["@vidok/site-to-mcp", "stdio", "--baked", "/path/to/seo-bake"]
 *       }
 *     }
 *   }
 */

import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { createSiteToMcp } from '../factory.js';
import { runStdio } from '../core/mcp-server/stdio.js';

interface ParsedArgs {
  bakedDir?: string;
  siteUrl: string;
  brandName: string;
  configPath?: string;
}

function parseArgs(): ParsedArgs {
  const args = process.argv.slice(2);
  let bakedDir: string | undefined;
  let siteUrl = 'https://example.com';
  let brandName = 'Example';
  let configPath: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--baked' && args[i + 1]) {
      bakedDir = resolve(args[i + 1]!);
      i++;
    } else if (a === '--site' && args[i + 1]) {
      siteUrl = args[i + 1]!;
      i++;
    } else if (a === '--brand' && args[i + 1]) {
      brandName = args[i + 1]!;
      i++;
    } else if (a === '--config' && args[i + 1]) {
      configPath = resolve(args[i + 1]!);
      i++;
    }
  }
  return { ...(bakedDir ? { bakedDir } : {}), siteUrl, brandName, ...(configPath ? { configPath } : {}) };
}

function loadConfig(path: string): { siteUrl: string; brand: { name: string }; bakedDir?: string } | null {
  try {
    return require(path);
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const args = parseArgs();
  let siteUrl = args.siteUrl;
  let brand: { name: string } = { name: args.brandName };
  let bakedDir: string | undefined = args.bakedDir;

  if (args.configPath && existsSync(args.configPath)) {
    const cfg = loadConfig(args.configPath);
    if (cfg) {
      siteUrl = cfg.siteUrl;
      brand = cfg.brand;
      bakedDir = cfg.bakedDir ?? bakedDir;
    }
  }

  process.stderr.write(`[s2m-stdio] ${brand.name} (${siteUrl})${bakedDir ? ` baked=${bakedDir}` : ' no-bake'}\n`);

  const s2m = createSiteToMcp({
    siteUrl,
    brand,
    ...(bakedDir ? { bakedDir } : {}),
  });

  const mcp = s2m.createMCPServer();
  runStdio(mcp);
}

main().catch((err) => {
  process.stderr.write(`[s2m-stdio] crashed: ${err}\n`);
  process.exit(1);
});
