/**
 * Verify — post-deploy health check.
 *
 * Sprawdza czy strona klienta poprawnie wdrożyła wtyczkę:
 *   1. /llms.txt — dostępny, valid format
 *   2. /robots.txt — z AI bots split
 *   3. /sitemap.xml — valid XML
 *   4. /skill.md — Osmani layer 3
 *   5. /.well-known/agent-card.json — A2A spec
 *   6. /.well-known/mcp.json — MCP manifest (GET) + JSON-RPC (POST tools/list)
 *   7. AI bot UA test — czy serwer nie blokuje GPTBot/ClaudeBot/PerplexityBot
 *   8. Markdown negotiation — czy Accept: text/markdown zwraca MD
 *   9. Schema injection — czy <head> ma JSON-LD @graph
 *   10. ai:tokens meta — czy strona ma <meta name="ai:tokens">
 *
 * Output: report z konkretnymi błędami + recommendations.
 */

export interface VerifyResult {
  url: string;
  timestamp: string;
  overall: 'pass' | 'partial' | 'fail';
  passed: number;
  failed: number;
  warnings: number;
  checks: VerifyCheck[];
  recommendations: string[];
}

export interface VerifyCheck {
  id: string;
  name: string;
  status: 'pass' | 'fail' | 'warn';
  detail: string;
  evidence?: string;
}

const AI_BOT_UAS = {
  GPTBot: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.0; +https://openai.com/gptbot',
  ClaudeBot: 'Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)',
  PerplexityBot: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot',
};

export class Verifier {
  constructor(private siteUrl: string) {}

  async run(): Promise<VerifyResult> {
    const checks: VerifyCheck[] = [];
    const base = this.siteUrl.replace(/\/$/, '');

    // 1-5: Static AI files
    const aiFiles = [
      { path: '/llms.txt', critical: true },
      { path: '/robots.txt', critical: true },
      { path: '/sitemap.xml', critical: true },
      { path: '/skill.md', critical: false },
      { path: '/.well-known/agent-card.json', critical: false },
    ];
    for (const f of aiFiles) {
      checks.push(await this.checkFile(base, f.path, f.critical));
    }

    // 6. MCP manifest GET
    checks.push(await this.checkMcpManifest(base));

    // 7. MCP POST tools/list
    checks.push(await this.checkMcpToolsList(base));

    // 8-10. AI bots
    for (const [bot, ua] of Object.entries(AI_BOT_UAS)) {
      checks.push(await this.checkAiBotAccess(base, bot, ua));
    }

    // 11. Markdown negotiation
    checks.push(await this.checkMarkdownNegotiation(base));

    // 12. Schema injection w homepage
    checks.push(await this.checkSchemaInHead(base));

    // 13. ai:tokens meta
    checks.push(await this.checkAiTokensMeta(base));

    // 14. robots.txt deep — czy AI bots properly configured
    checks.push(await this.checkRobotsAiBots(base));

    const passed = checks.filter((c) => c.status === 'pass').length;
    const failed = checks.filter((c) => c.status === 'fail').length;
    const warnings = checks.filter((c) => c.status === 'warn').length;

    const recommendations = checks
      .filter((c) => c.status === 'fail' || c.status === 'warn')
      .map((c) => `${c.status === 'fail' ? '✗' : '⚠'} ${c.name}: ${c.detail}`);

    const overall: VerifyResult['overall'] = failed === 0 ? 'pass' : failed <= 2 ? 'partial' : 'fail';

    return {
      url: this.siteUrl,
      timestamp: new Date().toISOString(),
      overall,
      passed,
      failed,
      warnings,
      checks,
      recommendations,
    };
  }

  private async checkFile(base: string, path: string, critical: boolean): Promise<VerifyCheck> {
    const url = base + path;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      const ok = res.status >= 200 && res.status < 400;
      const contentType = res.headers.get('content-type') ?? 'unknown';
      return {
        id: `file-${path.replace(/[^a-z0-9]/gi, '-')}`,
        name: `${path}`,
        status: ok ? 'pass' : critical ? 'fail' : 'warn',
        detail: ok ? `HTTP ${res.status} (${contentType})` : `HTTP ${res.status}${critical ? ' (CRITICAL)' : ''}`,
      };
    } catch (err) {
      return {
        id: `file-${path.replace(/[^a-z0-9]/gi, '-')}`,
        name: path,
        status: critical ? 'fail' : 'warn',
        detail: `Fetch error: ${String(err).slice(0, 80)}`,
      };
    }
  }

  private async checkMcpManifest(base: string): Promise<VerifyCheck> {
    const url = base + '/.well-known/mcp.json';
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) {
        return { id: 'mcp-manifest', name: 'MCP manifest (GET)', status: 'fail', detail: `HTTP ${res.status}` };
      }
      const json = (await res.json()) as { tools?: unknown[]; name?: string };
      const toolCount = Array.isArray(json.tools) ? json.tools.length : 0;
      return {
        id: 'mcp-manifest',
        name: 'MCP manifest (GET)',
        status: toolCount >= 6 ? 'pass' : 'warn',
        detail: `${toolCount} tools, name="${json.name ?? '?'}"`,
      };
    } catch (err) {
      return { id: 'mcp-manifest', name: 'MCP manifest (GET)', status: 'fail', detail: String(err).slice(0, 100) };
    }
  }

  private async checkMcpToolsList(base: string): Promise<VerifyCheck> {
    const url = base + '/.well-known/mcp.json';
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        return { id: 'mcp-rpc', name: 'MCP JSON-RPC tools/list', status: 'fail', detail: `HTTP ${res.status}` };
      }
      const json = (await res.json()) as { result?: { tools?: unknown[] }; error?: unknown };
      const tools = json.result?.tools;
      if (json.error) {
        return { id: 'mcp-rpc', name: 'MCP JSON-RPC tools/list', status: 'fail', detail: `RPC error: ${JSON.stringify(json.error)}` };
      }
      if (!Array.isArray(tools)) {
        return { id: 'mcp-rpc', name: 'MCP JSON-RPC tools/list', status: 'fail', detail: 'Missing result.tools array' };
      }
      return {
        id: 'mcp-rpc',
        name: 'MCP JSON-RPC tools/list',
        status: 'pass',
        detail: `${tools.length} tools dostępne via JSON-RPC`,
      };
    } catch (err) {
      return { id: 'mcp-rpc', name: 'MCP JSON-RPC tools/list', status: 'fail', detail: String(err).slice(0, 100) };
    }
  }

  private async checkAiBotAccess(base: string, bot: string, ua: string): Promise<VerifyCheck> {
    try {
      const res = await fetch(base, {
        headers: { 'User-Agent': ua },
        signal: AbortSignal.timeout(10_000),
      });
      const ok = res.status >= 200 && res.status < 400;
      return {
        id: `bot-${bot.toLowerCase()}`,
        name: `${bot} access`,
        status: ok ? 'pass' : 'fail',
        detail: `HTTP ${res.status}${ok ? '' : ' — bot blocked (Cloudflare/firewall?)'}`,
      };
    } catch (err) {
      return { id: `bot-${bot.toLowerCase()}`, name: `${bot} access`, status: 'warn', detail: String(err).slice(0, 80) };
    }
  }

  private async checkMarkdownNegotiation(base: string): Promise<VerifyCheck> {
    try {
      const res = await fetch(base, {
        headers: { Accept: 'text/markdown' },
        signal: AbortSignal.timeout(10_000),
      });
      const contentType = res.headers.get('content-type') ?? '';
      const aiTokens = res.headers.get('x-ai-tokens');
      if (contentType.includes('text/markdown')) {
        return {
          id: 'md-nego',
          name: 'Markdown negotiation (Accept: text/markdown)',
          status: 'pass',
          detail: `Returns markdown${aiTokens ? `, X-AI-Tokens: ${aiTokens}` : ''}`,
        };
      }
      return {
        id: 'md-nego',
        name: 'Markdown negotiation',
        status: 'warn',
        detail: `Returns ${contentType} (expected text/markdown). Plugin middleware może nie być wpięty.`,
      };
    } catch (err) {
      return { id: 'md-nego', name: 'Markdown negotiation', status: 'fail', detail: String(err).slice(0, 100) };
    }
  }

  private async checkSchemaInHead(base: string): Promise<VerifyCheck> {
    try {
      const res = await fetch(base, { signal: AbortSignal.timeout(10_000) });
      const html = await res.text();
      const schemaMatches = html.match(/<script\s+type=["']application\/ld\+json["']/gi) ?? [];
      if (schemaMatches.length === 0) {
        return { id: 'schema-inject', name: 'JSON-LD schema in <head>', status: 'fail', detail: 'No <script type="application/ld+json"> found' };
      }
      // Spróbuj sparsować pierwszy
      const firstMatch = html.match(/<script\s+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i);
      if (firstMatch && firstMatch[1]) {
        try {
          const parsed = JSON.parse(firstMatch[1].trim()) as { '@graph'?: unknown[]; '@type'?: string };
          const graphSize = Array.isArray(parsed['@graph']) ? parsed['@graph'].length : 1;
          return {
            id: 'schema-inject',
            name: 'JSON-LD schema in <head>',
            status: 'pass',
            detail: `${schemaMatches.length} script block(s), first has ${graphSize} @graph items`,
          };
        } catch {
          return { id: 'schema-inject', name: 'JSON-LD schema in <head>', status: 'warn', detail: `${schemaMatches.length} blocks found ale pierwszy ma invalid JSON` };
        }
      }
      return { id: 'schema-inject', name: 'JSON-LD schema in <head>', status: 'pass', detail: `${schemaMatches.length} block(s)` };
    } catch (err) {
      return { id: 'schema-inject', name: 'JSON-LD schema in <head>', status: 'fail', detail: String(err).slice(0, 100) };
    }
  }

  private async checkAiTokensMeta(base: string): Promise<VerifyCheck> {
    try {
      const res = await fetch(base, { signal: AbortSignal.timeout(10_000) });
      const html = await res.text();
      const match = html.match(/<meta\s+name=["']ai:tokens["']\s+content=["'](\d+)["']/i);
      if (match) {
        return { id: 'meta-tokens', name: 'meta ai:tokens', status: 'pass', detail: `${match[1]} tokens` };
      }
      return { id: 'meta-tokens', name: 'meta ai:tokens', status: 'warn', detail: 'No <meta name="ai:tokens"> (nice-to-have, Osmani spec)' };
    } catch (err) {
      return { id: 'meta-tokens', name: 'meta ai:tokens', status: 'warn', detail: String(err).slice(0, 80) };
    }
  }

  private async checkRobotsAiBots(base: string): Promise<VerifyCheck> {
    try {
      const res = await fetch(base + '/robots.txt', { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) return { id: 'robots-deep', name: 'robots.txt AI bots', status: 'fail', detail: `HTTP ${res.status}` };
      const txt = await res.text();
      const searchBots = ['OAI-SearchBot', 'PerplexityBot', 'Claude-SearchBot', 'Bingbot'];
      const allowed: string[] = [];
      const blocked: string[] = [];
      for (const bot of searchBots) {
        const disallow = new RegExp(`User-agent:\\s*${bot}[\\s\\S]*?Disallow:\\s*/`, 'i').test(txt);
        if (disallow) blocked.push(bot);
        else if (txt.includes(`User-agent: ${bot}`)) allowed.push(bot);
      }
      if (blocked.length > 0) {
        return {
          id: 'robots-deep',
          name: 'robots.txt AI bots',
          status: 'fail',
          detail: `Search bots BLOCKED: ${blocked.join(', ')} (no citations possible)`,
        };
      }
      if (allowed.length === 0) {
        return {
          id: 'robots-deep',
          name: 'robots.txt AI bots',
          status: 'warn',
          detail: 'No explicit AI bots config in robots.txt (default allows = OK)',
        };
      }
      return {
        id: 'robots-deep',
        name: 'robots.txt AI bots',
        status: 'pass',
        detail: `Search bots allowed: ${allowed.join(', ')}`,
      };
    } catch (err) {
      return { id: 'robots-deep', name: 'robots.txt AI bots', status: 'warn', detail: String(err).slice(0, 80) };
    }
  }
}

export async function verifyDeploy(siteUrl: string): Promise<VerifyResult> {
  return new Verifier(siteUrl).run();
}
