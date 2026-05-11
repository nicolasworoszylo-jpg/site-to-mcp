/**
 * Pobranie strony jako 5 różnych user-agents (jeden po drugim, lekko).
 *
 * AI crawlery często widzą inną wersję strony niż przeglądarka. Sprawdzamy
 * czy serwer nie blokuje (403/429), czy zwraca SSR vs CSR i czy content jest
 * w pełni renderowany w HTML (bez wykonywania JS).
 *
 * Iron law: nie wykonujemy JS. Jeśli content jest tylko po hydration —
 * dla LLM to jakby go nie było.
 */

export const AI_BOT_USER_AGENTS = {
  GPTBot: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.0; +https://openai.com/gptbot',
  ClaudeBot: 'Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)',
  PerplexityBot: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot',
  'Google-Extended': 'Mozilla/5.0 (compatible; Google-Extended/1.0)',
  Googlebot: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  Browser: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
} as const;

export type BotName = keyof typeof AI_BOT_USER_AGENTS;

export interface FetchResult {
  bot: BotName;
  status: number;
  contentType: string;
  bytes: number;
  html: string;
  headers: Record<string, string>;
  durationMs: number;
}

/**
 * SSRF guard — odrzuca prywatne IP, loopback, link-local i metadane chmurowe.
 *
 * Dlaczego: gdy plugin jest exposed jako SaaS audit endpoint, atakujący
 * mogliby uderzyć w `http://169.254.169.254/...` (AWS metadata) albo
 * `http://localhost:6379` (Redis). DNS lookup + IP check przed fetch.
 *
 * Wyłączenie (na własne ryzyko): env `S2M_DISABLE_SSRF_GUARD=1`.
 */
const PRIVATE_IP_PATTERNS = [
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
  /^169\.254\./,
  /^0\./,
  /^::1$/,
  /^fe80:/i,
  /^fc[0-9a-f]{2}:/i,
  /^fd[0-9a-f]{2}:/i,
];

function isPrivateIp(addr: string): boolean {
  return PRIVATE_IP_PATTERNS.some((re) => re.test(addr));
}

export async function assertSafeUrl(url: string): Promise<void> {
  const u = new URL(url);
  if (!['http:', 'https:'].includes(u.protocol)) {
    throw new Error(`Only HTTP(S) URLs allowed (got: ${u.protocol})`);
  }
  if (process.env['S2M_DISABLE_SSRF_GUARD'] === '1') return;
  // Sprawdź czy host jest IP literałem — częsty obejście DNS
  const host = u.hostname;
  if (isPrivateIp(host)) {
    throw new Error(`Private IP blocked: ${host}`);
  }
  // DNS lookup — w środowiskach bez Node DNS (Workers/Edge) pomiń
  try {
    const dns = await import('node:dns/promises');
    const addrs = await dns.lookup(host, { all: true });
    for (const a of addrs) {
      if (isPrivateIp(a.address)) {
        throw new Error(`DNS resolves ${host} to private IP: ${a.address}`);
      }
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Private IP') || err instanceof Error && err.message.startsWith('DNS resolves')) {
      throw err;
    }
    // node:dns niedostępne (Workers) — polegamy na hostname check
  }
}

export async function fetchAs(url: string, bot: BotName, timeoutMs = 15000): Promise<FetchResult> {
  await assertSafeUrl(url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const start = Date.now();
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': AI_BOT_USER_AGENTS[bot],
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'pl-PL,pl;q=0.9,en;q=0.8',
      },
      signal: controller.signal,
      redirect: 'follow',
    });
    const html = await res.text();
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => (headers[k] = v));
    return {
      bot,
      status: res.status,
      contentType: res.headers.get('content-type') ?? 'unknown',
      bytes: new Blob([html]).size,
      html,
      headers,
      durationMs: Date.now() - start,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchAllBots(url: string, bots: BotName[] = ['Browser', 'GPTBot', 'ClaudeBot', 'PerplexityBot']): Promise<FetchResult[]> {
  return Promise.all(bots.map((b) => fetchAs(url, b).catch((err) => ({
    bot: b,
    status: 0,
    contentType: 'error',
    bytes: 0,
    html: '',
    headers: {},
    durationMs: 0,
    error: String(err),
  } as FetchResult & { error: string }))));
}

/**
 * Heurystyka rendering: porównuje rozmiar i obecność <h1>/<article>/<p> w HTML
 * vs po-CSR fallback (placeholder z React/Next "loading").
 */
export function detectRendering(html: string): 'ssr' | 'csr' | 'static' | 'unknown' {
  const lowered = html.toLowerCase();
  // CSR oznaki: pusty <div id="__next">, "loading", "javascript required"
  const csrSignals = [
    /<div id=["']__next["']><\/div>/,
    /<div id=["']root["']>\s*<\/div>/,
    /<noscript>[^<]*javascript[^<]*<\/noscript>/i,
    /please\s+enable\s+javascript/i,
  ];
  if (csrSignals.some((re) => re.test(html))) return 'csr';

  // Static/SSR: mamy konkretną treść w HTML
  const hasContent = /<h1[\s>]/i.test(lowered) && /<p[\s>]/i.test(lowered);
  const hasArticle = /<article[\s>]/i.test(lowered) || /<main[\s>]/i.test(lowered);
  if (hasContent && hasArticle) return 'ssr';
  if (hasContent) return 'static';

  return 'unknown';
}
