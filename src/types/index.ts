/**
 * site-to-mcp — wspólne typy dla wszystkich modułów.
 *
 * Filozofia: jedno źródło prawdy o tym, co audit zwraca, co autofix przyjmuje
 * i co MCP serializuje. Każdy adapter mówi w tym samym dialekcie.
 */

// ============================================================================
// AUDIT
// ============================================================================

export type AuditLayer =
  | 'indexability'
  | 'schema'
  | 'semantic_html'
  | 'content'
  | 'ai_files'
  | 'performance';

export type FindingSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export type FindingStatus = 'pass' | 'fail' | 'warning' | 'skip';

export interface Finding {
  id: string;
  layer: AuditLayer;
  status: FindingStatus;
  severity: FindingSeverity;
  title: string;
  detail: string;
  evidence?: unknown;
  recommendation?: string;
  autofixable: boolean;
  autofix?: AutofixRef;
  /** Citation z badania (np. "Indig 30M citations: 44.2% from first 30%") */
  citation?: string;
  /** Estymowany impact: 0-100 */
  impact?: number;
}

export interface AutofixRef {
  action: string;
  args: Record<string, unknown>;
  /** Risk gdyby coś się nie udało: zero/low/medium/high */
  risk: 'zero' | 'low' | 'medium' | 'high';
}

export interface AuditReport {
  url: string;
  timestamp: string;
  /** Per layer 0-100 + overall */
  scores: Record<AuditLayer | 'overall', number>;
  findings: Finding[];
  meta: {
    httpStatus: number;
    contentType?: string;
    title?: string;
    description?: string;
    canonical?: string;
    lang?: string;
    /** Wykryty rendering: ssr/csr/static */
    rendering?: 'ssr' | 'csr' | 'static' | 'unknown';
    /** Lista AI bots które dostały content (z headers UA test) */
    aiBotAccess?: Record<string, boolean>;
  };
  /** Surowy HTML (opcjonalnie, dla autofix offline) */
  rawHtml?: string;
}

// ============================================================================
// AUTOFIX
// ============================================================================

export interface AutofixAction {
  id: string;
  type:
    | 'inject_schema'
    | 'inject_meta'
    | 'inject_html'
    | 'replace_html'
    | 'wrap_html'
    | 'add_attribute'
    | 'generate_file';
  target: string; // CSS selector lub path do pliku
  payload: unknown;
  reason: string;
  citation?: string;
  risk: 'zero' | 'low' | 'medium' | 'high';
}

export interface AutofixResult {
  applied: AutofixAction[];
  skipped: Array<AutofixAction & { skipReason: string }>;
  beforeHash: string;
  afterHash: string;
  diff?: string;
  filesGenerated?: Array<{ path: string; bytes: number }>;
}

// ============================================================================
// SCHEMA
// ============================================================================

export type SchemaTier = 1 | 2 | 3;
export type SchemaType =
  | 'Organization'
  | 'WebSite'
  | 'WebPage'
  | 'Article'
  | 'BlogPosting'
  | 'NewsArticle'
  | 'BreadcrumbList'
  | 'FAQPage'
  | 'Person'
  | 'Product'
  | 'LocalBusiness'
  | 'HowTo'
  | 'Review'
  | 'AggregateRating'
  | 'Event'
  | 'VideoObject'
  | 'ImageObject'
  | 'SpeakableSpecification'
  | 'Service'
  | 'SoftwareApplication'
  | 'CreativeWork'
  | 'Recipe'
  | 'JobPosting'
  | 'Course'
  | 'QAPage';

export interface SchemaContext {
  type: SchemaType;
  data: Record<string, unknown>;
  /** Czy injectuje się site-wide czy per-page */
  scope: 'site' | 'page';
  /** Tier 1 = obowiązkowy zawsze, 2 = jeśli zasadne, 3 = niche */
  tier: SchemaTier;
}

// ============================================================================
// CONTENT EXTRACTION
// ============================================================================

export interface ExtractedContent {
  url: string;
  title: string;
  description?: string;
  lang?: string;
  /** Czyste markdown przeznaczone dla LLM */
  markdown: string;
  /** Pełna lista headings z poziomami + czy są pytaniami */
  headings: Array<{ level: 1 | 2 | 3 | 4 | 5 | 6; text: string; isQuestion: boolean; anchor?: string }>;
  /** Wyciągnięte Q&A pary (z FAQ albo z H/p pattern) */
  qa: Array<{ question: string; answer: string; wordCount: number }>;
  /** Statystyki/liczby znalezione w treści */
  stats: Array<{ value: string; context: string; source?: string }>;
  /** Cytaty (blockquote albo "kwoty z atrybucją") */
  quotes: Array<{ text: string; attribution?: string }>;
  /** Tabele (HTML tables po konwersji) */
  tables: Array<{ caption?: string; headers: string[]; rows: string[][] }>;
  /** Wykryte entities (NER lekki - tylko proper nouns + linki) */
  entities: Array<{ name: string; occurrences: number; type?: 'org' | 'person' | 'product' | 'place' }>;
  /** Word count, entity density, hemingway grade */
  metrics: {
    wordCount: number;
    entityDensityPct: number;
    statsCount: number;
    questionMarksCount: number;
    h3QuestionsPct: number;
    first30PctAnswered: boolean;
    avgChunkWords: number;
  };
  /** Schema.org JSON-LD wykryte na stronie */
  schemaFound: SchemaContext[];
  /** Linki zewnętrzne (autorytatywne źródła) */
  outboundLinks: Array<{ href: string; text: string; domain: string; isAuthoritative: boolean }>;
}

// ============================================================================
// MCP
// ============================================================================

export interface MCPManifest {
  /** MCP server metadata */
  name: string;
  version: string;
  description: string;
  /** Baza URL serwowanego MCP (np. https://example.com/.well-known/mcp) */
  baseUrl: string;
  /** Dostępne narzędzia */
  tools: MCPTool[];
  /** Dostępne zasoby (statyczne content URI) */
  resources: MCPResource[];
  /** Polityki dostępu */
  policies: {
    rateLimitPerMin: number;
    allowedBots: string[];
    requireAuth: boolean;
  };
}

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface MCPResource {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}

// ============================================================================
// MONITORING
// ============================================================================

export interface PromptTest {
  id: string;
  prompt: string;
  language: string;
  brand: string;
  /** Konkurencja do śledzenia (czy oni są cytowani gdy ty nie) */
  competitors?: string[];
}

export interface CitationCheck {
  promptId: string;
  engine: 'chatgpt' | 'perplexity' | 'claude' | 'gemini' | 'google_aio';
  timestamp: string;
  cited: boolean;
  /** Tekst odpowiedzi w którym znaleziono cytowanie */
  citationExcerpt?: string;
  /** Kto inny cytowany */
  otherCitations: string[];
  /** Sentyment cytowania */
  sentiment?: 'positive' | 'neutral' | 'negative';
  rawResponse?: string;
}

export interface MonitoringReport {
  periodStart: string;
  periodEnd: string;
  brand: string;
  citationRate: Record<string, number>; // engine -> 0..1
  shareOfVoice: number; // 0..1
  newMentions: string[];
  lostMentions: string[];
  sentimentBreakdown: Record<'positive' | 'neutral' | 'negative', number>;
  details: CitationCheck[];
}

// ============================================================================
// CONFIG
// ============================================================================

export interface SiteToMcpConfig {
  /** Bazowy URL strony (np. https://example.com) */
  siteUrl: string;
  /** Nazwa marki/organizacji */
  brand: {
    name: string;
    legalName?: string;
    description?: string;
    logo?: string;
    sameAs?: string[]; // social profiles
    contact?: { email?: string; phone?: string; address?: string };
    /** Person schema dla głównego autora */
    primaryAuthor?: {
      name: string;
      jobTitle?: string;
      url?: string;
      sameAs?: string[];
      image?: string;
      credentials?: string[];
    };
  };
  /**
   * Jakie AI boty wpuszczamy w robots.txt.
   *
   * Search bots (cytowania w odpowiedziach AI) — rekomendowane allow:
   *   OAI-SearchBot, ChatGPT-User, PerplexityBot, Claude-SearchBot, Claude-User, Bingbot
   *
   * Training bots (treningowanie modeli) — decyzja użytkownika:
   *   GPTBot, ClaudeBot, Google-Extended, AppleBot-Extended, CCBot, Bytespider, Meta-ExternalAgent
   *
   * Mixed/ambiguous (decyzja użytkownika):
   *   AppleBot, YouBot
   *
   * Source: nohacks.co/blog/ai-user-agents-landscape-2026
   */
  aiBots: {
    // training
    GPTBot: boolean;
    ClaudeBot: boolean;
    'Google-Extended': boolean;
    'AppleBot-Extended': boolean;
    CCBot: boolean;
    Bytespider: boolean;
    'Meta-ExternalAgent': boolean;
    // search (rekomendowane allow)
    'OAI-SearchBot': boolean;
    'ChatGPT-User': boolean;
    PerplexityBot: boolean;
    'Claude-SearchBot': boolean;
    'Claude-User': boolean;
    Bingbot: boolean;
    // mixed
    AppleBot: boolean;
    YouBot: boolean;
  };
  /** Adres MCP endpoint który serwujemy */
  mcp?: {
    enabled: boolean;
    path: string; // domyślnie /.well-known/mcp
    rateLimitPerMin: number;
    requireAuth: boolean;
    authToken?: string;
  };
  /** llms.txt config */
  llmsTxt?: {
    enabled: boolean;
    path: string; // /llms.txt
    fullPath: string; // /llms-full.txt
    /** Manualnie zdefiniowane sekcje */
    sections?: Array<{ title: string; links: Array<{ url: string; title: string; description?: string }> }>;
  };
  /** Monitoring config */
  monitoring?: {
    enabled: boolean;
    prompts: PromptTest[];
    engines: Array<'chatgpt' | 'perplexity' | 'claude' | 'gemini'>;
    apiKeys?: { openai?: string; anthropic?: string; perplexity?: string; google?: string };
    /** Webhook do alertów */
    webhookUrl?: string;
    schedule?: string; // cron
  };
  /** Autofix policy */
  autofix?: {
    /** Czy autofix może modyfikować HTML in-place (default false — tylko propose) */
    mutate: boolean;
    /** Które typy fixów są dozwolone bez review */
    allowed: Array<AutofixAction['type']>;
    /** Max risk poziom autofixu */
    maxRisk: 'zero' | 'low' | 'medium' | 'high';
  };
}

// ============================================================================
// PLUGIN HOOKS
// ============================================================================

export interface PluginHooks {
  beforeAudit?: (url: string) => void | Promise<void>;
  afterAudit?: (report: AuditReport) => AuditReport | Promise<AuditReport>;
  beforeAutofix?: (actions: AutofixAction[]) => AutofixAction[] | Promise<AutofixAction[]>;
  afterAutofix?: (result: AutofixResult) => void | Promise<void>;
  onCitationDetected?: (check: CitationCheck) => void | Promise<void>;
}
