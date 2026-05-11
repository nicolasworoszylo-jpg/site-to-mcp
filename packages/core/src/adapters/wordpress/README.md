# Site to MCP — WordPress plugin

Self-contained PHP plugin. Zero JavaScript dependencies. Wszystkie generatory (llms.txt, robots.txt, schema, MCP) zaimplementowane natywnie w PHP.

## Instalacja

1. Skopiuj plik `site-to-mcp.php` do `wp-content/plugins/site-to-mcp/site-to-mcp.php`
2. WordPress Admin → Plugins → Aktywuj "Site to MCP — SEO for LLM"
3. Settings → Site to MCP → ustaw AI bots policy
4. Po aktywacji **odśwież permalinki** (Settings → Permalinks → Save)

## Co plugin dodaje do strony

| Endpoint | Co serwuje |
|----------|------------|
| `/llms.txt` | Site map dla LLM-ów (AnswerDotAI spec) |
| `/llms-full.txt` | Pełna treść postów/stron, cap ~25k tokens |
| `/skill.md` | Osmani layer 3 — jak agent może użyć strony |
| `/AGENTS.md` | Stub do uzupełnienia przez właściciela |
| `/.well-known/agent-card.json` | A2A discovery |
| `/.well-known/mcp.json` | MCP-over-HTTP endpoint (GET = manifest, POST = JSON-RPC) |
| `/robots.txt` | Z poprawnym AI bots split (GPTBot vs OAI-SearchBot itd.) |
| Każdy URL | Gdy `Accept: text/markdown` lub AI bot UA → markdown response z `X-AI-Tokens` |

## Co plugin dodaje do `<head>`

- JSON-LD `@graph` z Organization + WebSite + Article/BlogPosting + Person (author)
- `<meta name="ai:tokens" content="...">` — token count strony

## Co plugin dodaje do treści

- Button "📋 Copy for AI" pod postami (kopiuje markdown wersję do schowka)

## Konfiguracja przez code

```php
// functions.php twojego motywu
add_filter('s2m_ai_bots', function($bots) {
    return [
        'GPTBot' => false,           // training - decyzja
        'ClaudeBot' => false,        // training
        'PerplexityBot' => true,     // search/citation
        'OAI-SearchBot' => true,     // search (recommended)
        'Google-Extended' => false,  // training
        'Bingbot' => true,
    ];
});
```

## MCP usage z Claude Desktop

W `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "twoja-strona": {
      "url": "https://twoja-strona.pl/.well-known/mcp.json"
    }
  }
}
```

Claude będzie miał narzędzia `list_pages`, `get_page`, `search_pages` na twojej stronie.
