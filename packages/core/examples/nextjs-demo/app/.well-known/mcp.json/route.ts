/**
 * MCP-over-HTTP endpoint dla zaproszeniaonline.com.
 *
 * GET → returns manifest (lista narzędzi + resources)
 * POST → JSON-RPC dispatch (tools/list, tools/call, resources/list, resources/read)
 *
 * Test from CLI:
 *   curl https://zaproszeniaonline.com/.well-known/mcp.json
 *   curl -X POST https://zaproszeniaonline.com/.well-known/mcp.json \
 *     -H "Content-Type: application/json" \
 *     -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
 */

import { createMcpRoute } from '@vidok/site-to-mcp/next';
import config from '../../../s2m.config.json';

const handler = createMcpRoute(config);

export const GET = handler;
export const POST = handler;
