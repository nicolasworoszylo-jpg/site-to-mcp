/**
 * MCP STDIO bridge.
 *
 * Łączy MCP-over-HTTP server z STDIO transport (newline-delimited JSON-RPC).
 * Claude Desktop config:
 *
 *   {
 *     "mcpServers": {
 *       "klient-pl": {
 *         "command": "node",
 *         "args": ["/path/to/site-to-mcp-stdio.mjs", "--baked", "/path/to/seo-bake"]
 *       }
 *     }
 *   }
 *
 * Stdio czyta JSON-RPC z stdin (jeden per linia), wykonuje przez MCPServer,
 * pisze JSON-RPC do stdout. Stderr dla logów.
 */

import { createInterface } from 'node:readline';
import type { MCPServer, JsonRpcRequest } from './index.js';

export function runStdio(server: MCPServer, opts: { log?: (msg: string) => void } = {}): void {
  const log = opts.log ?? ((m) => process.stderr.write(`[mcp-stdio] ${m}\n`));
  log('MCP STDIO bridge ready');

  const rl = createInterface({ input: process.stdin, terminal: false });
  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    void (async () => {
      try {
        const req = JSON.parse(trimmed) as JsonRpcRequest;
        const res = await server.handle(req);
        process.stdout.write(JSON.stringify(res) + '\n');
      } catch (err) {
        const errResp = {
          jsonrpc: '2.0',
          id: null,
          error: { code: -32700, message: `Parse error: ${err}` },
        };
        process.stdout.write(JSON.stringify(errResp) + '\n');
      }
    })();
  });

  rl.on('close', () => {
    log('STDIO closed, exiting');
    process.exit(0);
  });
}
