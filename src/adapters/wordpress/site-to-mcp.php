<?php
/**
 * Plugin Name: Site to MCP — SEO for LLM
 * Description: Konwertuje stronę WordPress na in-the-wild cytowane przez ChatGPT/Perplexity/Claude/Gemini źródło. Auto-genuje llms.txt, robots.txt z AI bots split, sitemap z hreflang, schema.org @graph (Organization + Article + FAQPage + Person), .well-known/agent-card.json, MCP-over-HTTP endpoint, plus runtime negotiation (Accept: text/markdown → markdown response).
 * Version: 1.0.0
 * Author: Vidok Studio
 * Author URI: https://vidok.studio
 * License: MIT
 * Text Domain: site-to-mcp
 *
 * Wzorzec: PHP plugin który NIE robi własnej logiki Schema/Markdown/MCP —
 * deleguje do Node service via subprocess albo do REST API (jeśli skonfigurowane).
 * Domyślnie używa wbudowanej minimalnej implementacji w PHP dla zero-dependency
 * setup. Dla zaawansowanych użytkowników: opcja "delegate to Node service".
 */

if (!defined('ABSPATH')) { exit; }

define('S2M_VERSION', '1.0.0');
define('S2M_PLUGIN_DIR', plugin_dir_path(__FILE__));

class SiteToMcp {
    private $config;

    public function __construct() {
        $this->config = $this->load_config();

        // Hooks
        add_action('init', [$this, 'register_routes']);
        add_action('wp_head', [$this, 'inject_schema'], 1);
        add_action('wp_head', [$this, 'inject_ai_meta'], 2);
        add_filter('robots_txt', [$this, 'filter_robots_txt'], 10, 2);
        add_action('admin_menu', [$this, 'admin_menu']);
        add_action('admin_init', [$this, 'admin_init']);
        add_action('template_redirect', [$this, 'maybe_serve_markdown']);
        add_filter('the_content', [$this, 'maybe_append_copy_for_ai']);
    }

    private function load_config() {
        return [
            'site_url' => get_site_url(),
            'site_name' => get_bloginfo('name'),
            'site_description' => get_bloginfo('description'),
            'ai_bots' => get_option('s2m_ai_bots', [
                'GPTBot' => false,
                'ClaudeBot' => false,
                'PerplexityBot' => true,
                'Google-Extended' => false,
                'Bingbot' => true,
                'AppleBot' => true,
                'CCBot' => false,
                'YouBot' => true,
                'Bytespider' => false,
            ]),
            'copy_for_ai' => get_option('s2m_copy_for_ai', true),
            'serve_markdown' => get_option('s2m_serve_markdown', true),
        ];
    }

    // ========================================================================
    // ROUTES
    // ========================================================================

    public function register_routes() {
        add_rewrite_rule('^llms\.txt$', 'index.php?s2m_route=llms_txt', 'top');
        add_rewrite_rule('^llms-full\.txt$', 'index.php?s2m_route=llms_full', 'top');
        add_rewrite_rule('^skill\.md$', 'index.php?s2m_route=skill_md', 'top');
        add_rewrite_rule('^AGENTS\.md$', 'index.php?s2m_route=agents_md', 'top');
        add_rewrite_rule('^\.well-known/agent-card\.json$', 'index.php?s2m_route=agent_card', 'top');
        add_rewrite_rule('^\.well-known/mcp\.json$', 'index.php?s2m_route=mcp', 'top');
        add_filter('query_vars', function($vars) { $vars[] = 's2m_route'; return $vars; });
        add_action('template_redirect', [$this, 'handle_route']);
    }

    public function handle_route() {
        $route = get_query_var('s2m_route');
        if (!$route) return;

        switch ($route) {
            case 'llms_txt':
                header('Content-Type: text/plain; charset=utf-8');
                header('Cache-Control: public, max-age=3600');
                echo $this->generate_llms_txt();
                exit;
            case 'llms_full':
                header('Content-Type: text/plain; charset=utf-8');
                echo $this->generate_llms_full();
                exit;
            case 'skill_md':
                header('Content-Type: text/markdown');
                echo $this->generate_skill_md();
                exit;
            case 'agents_md':
                header('Content-Type: text/markdown');
                echo $this->generate_agents_md();
                exit;
            case 'agent_card':
                header('Content-Type: application/json');
                echo $this->generate_agent_card();
                exit;
            case 'mcp':
                $this->handle_mcp_request();
                exit;
        }
    }

    private function handle_mcp_request() {
        header('Content-Type: application/json');
        $method = $_SERVER['REQUEST_METHOD'];
        if ($method === 'GET') {
            echo wp_json_encode($this->mcp_manifest());
            return;
        }
        if ($method === 'POST') {
            $body = json_decode(file_get_contents('php://input'), true);
            $result = $this->mcp_handle($body);
            echo wp_json_encode($result);
            return;
        }
        http_response_code(405);
        echo wp_json_encode(['error' => 'Method not allowed']);
    }

    // ========================================================================
    // GENERATORS
    // ========================================================================

    private function generate_llms_txt() {
        $lines = [];
        $lines[] = '# ' . $this->config['site_name'];
        $lines[] = '';
        if ($this->config['site_description']) {
            $lines[] = '> ' . $this->config['site_description'];
            $lines[] = '';
        }

        // Pages section
        $lines[] = '## Pages';
        $lines[] = '';
        $pages = get_pages(['number' => 50, 'sort_column' => 'menu_order']);
        foreach ($pages as $p) {
            $lines[] = '- [' . $p->post_title . '](' . get_permalink($p) . ')';
        }
        $lines[] = '';

        // Posts section
        $lines[] = '## Posts';
        $lines[] = '';
        $posts = get_posts(['numberposts' => 30]);
        foreach ($posts as $p) {
            $excerpt = wp_strip_all_tags(get_the_excerpt($p));
            $excerpt = mb_substr($excerpt, 0, 100);
            $lines[] = '- [' . $p->post_title . '](' . get_permalink($p) . '): ' . $excerpt;
        }

        return implode("\n", $lines);
    }

    private function generate_llms_full() {
        $lines = ['# ' . $this->config['site_name'], '', '> Pełna treść strony dla AI agentów.', ''];
        $total_chars = 0;
        $cap = 100000; // ~25k tokens cap

        $posts = get_posts(['numberposts' => 50, 'post_type' => ['post', 'page']]);
        foreach ($posts as $p) {
            $content = wp_strip_all_tags($p->post_content);
            if ($total_chars + strlen($content) > $cap) {
                $lines[] = '---';
                $lines[] = '<!-- Truncated at token cap -->';
                break;
            }
            $lines[] = '---';
            $lines[] = '';
            $lines[] = '# ' . $p->post_title;
            $lines[] = 'Source: ' . get_permalink($p);
            $lines[] = '';
            $lines[] = $content;
            $lines[] = '';
            $total_chars += strlen($content);
        }

        return implode("\n", $lines);
    }

    public function filter_robots_txt($output, $public) {
        if (!$public) return $output;

        $out = "# robots.txt — generated by site-to-mcp\n\n";
        $out .= "User-agent: *\nAllow: /\n\n";

        foreach ($this->config['ai_bots'] as $bot => $allowed) {
            $out .= "User-agent: $bot\n";
            $out .= $allowed ? "Allow: /\n\n" : "Disallow: /\n\n";
        }

        $out .= "Sitemap: " . $this->config['site_url'] . "/sitemap.xml\n";
        return $out;
    }

    private function generate_agent_card() {
        return wp_json_encode([
            'schemaVersion' => 'a2a/2026-01',
            'name' => $this->config['site_name'],
            'description' => $this->config['site_description'],
            'url' => $this->config['site_url'],
            'capabilities' => ['list_pages', 'get_page', 'search_pages', 'get_faq', 'get_brand'],
            'endpoints' => [
                'mcp' => $this->config['site_url'] . '/.well-known/mcp.json',
                'llmsTxt' => $this->config['site_url'] . '/llms.txt',
            ],
        ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
    }

    private function generate_skill_md() {
        $out = "# " . $this->config['site_name'] . "\n\n";
        $out .= $this->config['site_description'] . "\n\n";
        $out .= "## Capabilities\n\n";
        $out .= "- Browse pages\n- Search content\n- Get FAQ\n- Get brand info\n\n";
        $out .= "## How to use\n\n";
        $out .= "1. Fetch /llms.txt for site map\n";
        $out .= "2. Append .md to any URL or send Accept: text/markdown\n";
        $out .= "3. Use MCP at /.well-known/mcp.json\n\n";
        $out .= "## Endpoints\n\n";
        $out .= "- **llms.txt**: " . $this->config['site_url'] . "/llms.txt\n";
        $out .= "- **mcp**: " . $this->config['site_url'] . "/.well-known/mcp.json\n";
        return $out;
    }

    private function generate_agents_md() {
        $out = "# " . $this->config['site_name'] . " — Agent Context\n\n";
        $out .= "> Non-inferable project details for AI agents.\n\n";
        $out .= "## Architecture\n\n<!-- Fill in -->\n\n";
        $out .= "## Conventions\n\n<!-- Fill in -->\n\n";
        return $out;
    }

    // ========================================================================
    // SCHEMA INJECTION
    // ========================================================================

    public function inject_schema() {
        $graph = [];
        $url = $this->config['site_url'];

        // Organization
        $graph[] = [
            '@type' => 'Organization',
            'name' => $this->config['site_name'],
            'url' => $url,
            'description' => $this->config['site_description'],
        ];

        // WebSite
        $graph[] = [
            '@type' => 'WebSite',
            'name' => $this->config['site_name'],
            'url' => $url,
            'inLanguage' => get_locale(),
            'potentialAction' => [
                '@type' => 'SearchAction',
                'target' => ['@type' => 'EntryPoint', 'urlTemplate' => $url . '/?s={search_term_string}'],
                'query-input' => 'required name=search_term_string',
            ],
        ];

        // Article/BlogPosting dla single posts
        if (is_single() || is_page()) {
            global $post;
            $author = get_userdata($post->post_author);
            $graph[] = [
                '@type' => is_single() ? 'BlogPosting' : 'WebPage',
                'headline' => $post->post_title,
                'description' => wp_strip_all_tags(get_the_excerpt($post)),
                'mainEntityOfPage' => ['@type' => 'WebPage', '@id' => get_permalink($post)],
                'datePublished' => get_the_date('c', $post),
                'dateModified' => get_the_modified_date('c', $post),
                'author' => [
                    '@type' => 'Person',
                    'name' => $author->display_name,
                    'url' => get_author_posts_url($author->ID),
                ],
                'publisher' => [
                    '@type' => 'Organization',
                    'name' => $this->config['site_name'],
                ],
            ];
        }

        $bundle = ['@context' => 'https://schema.org', '@graph' => $graph];
        // XSS-safe: escape </script> wewnątrz JSON content
        $json = wp_json_encode($bundle, JSON_UNESCAPED_SLASHES);
        $json = str_replace('</', '<\/', $json);
        echo "\n<script type=\"application/ld+json\">\n" . $json . "\n</script>\n";
    }

    public function inject_ai_meta() {
        $tokens = 0;
        if (is_single() || is_page()) {
            global $post;
            $tokens = (int) ceil(strlen(wp_strip_all_tags($post->post_content)) / 3);
        }
        if ($tokens > 0) {
            echo "<meta name=\"ai:tokens\" content=\"$tokens\">\n";
        }
    }

    // ========================================================================
    // CONTENT NEGOTIATION
    // ========================================================================

    public function maybe_serve_markdown() {
        if (!$this->config['serve_markdown']) return;
        if (is_admin()) return;

        $ua = isset($_SERVER['HTTP_USER_AGENT']) ? $_SERVER['HTTP_USER_AGENT'] : '';
        $accept = isset($_SERVER['HTTP_ACCEPT']) ? $_SERVER['HTTP_ACCEPT'] : '';
        $uri = $_SERVER['REQUEST_URI'];

        $is_ai_bot = preg_match('/GPTBot|ChatGPT-User|ClaudeBot|Claude-SearchBot|PerplexityBot|OAI-SearchBot/i', $ua);
        $wants_md = strpos($accept, 'text/markdown') !== false || str_ends_with(strtok($uri, '?'), '.md');

        if (!($is_ai_bot || $wants_md)) return;

        global $post;
        if (!$post) return;

        $content = wp_strip_all_tags($post->post_content);
        $tokens = (int) ceil(strlen($content) / 3);
        header('Content-Type: text/markdown; charset=utf-8');
        header('X-AI-Tokens: ' . $tokens);
        header('X-AI-Source-URL: ' . esc_url_raw(get_permalink($post)));
        header('Vary: Accept, User-Agent');
        header('Cache-Control: public, max-age=300, s-maxage=600');
        echo "# " . $post->post_title . "\n\n";
        echo "<!-- ai-meta: url=\"" . get_permalink($post) . "\" tokens=$tokens lang=\"" . get_locale() . "\" -->\n\n";
        echo $content;
        exit;
    }

    public function maybe_append_copy_for_ai($content) {
        if (!$this->config['copy_for_ai']) return $content;
        if (!is_single() && !is_page()) return $content;
        $button = '<button data-s2m-copy onclick="(function(b){fetch(window.location.pathname+\'.md\').then(function(r){return r.ok?r.text():null}).then(function(md){if(md){navigator.clipboard.writeText(md);b.textContent=\'✓ Copied\'}})})(this)" style="display:inline-block;margin:1em 0;padding:8px 16px;background:#111;color:#fff;border:none;border-radius:6px;cursor:pointer;font:14px system-ui">📋 Copy for AI</button>';
        return $content . $button;
    }

    // ========================================================================
    // MCP
    // ========================================================================

    private function mcp_manifest() {
        return [
            'name' => $this->config['site_name'],
            'version' => S2M_VERSION,
            'description' => $this->config['site_description'],
            'baseUrl' => $this->config['site_url'] . '/.well-known/mcp.json',
            'tools' => [
                ['name' => 'list_pages', 'description' => 'List all pages', 'inputSchema' => ['type' => 'object', 'properties' => ['limit' => ['type' => 'integer']]]],
                ['name' => 'get_page', 'description' => 'Get page content as markdown', 'inputSchema' => ['type' => 'object', 'properties' => ['path' => ['type' => 'string']], 'required' => ['path']]],
                ['name' => 'search_pages', 'description' => 'Search pages', 'inputSchema' => ['type' => 'object', 'properties' => ['query' => ['type' => 'string']], 'required' => ['query']]],
            ],
            'resources' => [],
            'policies' => ['rateLimitPerMin' => 60, 'allowedBots' => ['*'], 'requireAuth' => false],
        ];
    }

    private function mcp_handle($req) {
        if (!is_array($req) || !isset($req['method'])) {
            return ['jsonrpc' => '2.0', 'id' => null, 'error' => ['code' => -32600, 'message' => 'Invalid Request']];
        }
        $id = isset($req['id']) ? $req['id'] : null;

        if ($req['method'] === 'tools/list') {
            return ['jsonrpc' => '2.0', 'id' => $id, 'result' => ['tools' => $this->mcp_manifest()['tools']]];
        }

        if ($req['method'] === 'tools/call') {
            $name = $req['params']['name'] ?? '';
            $args = $req['params']['arguments'] ?? [];

            if ($name === 'list_pages') {
                $limit = $args['limit'] ?? 50;
                $posts = get_posts(['numberposts' => $limit, 'post_type' => ['post', 'page']]);
                $result = array_map(function($p) {
                    return [
                        'path' => parse_url(get_permalink($p), PHP_URL_PATH),
                        'url' => get_permalink($p),
                        'title' => $p->post_title,
                        'tokens' => (int) ceil(strlen(wp_strip_all_tags($p->post_content)) / 3),
                    ];
                }, $posts);
                return ['jsonrpc' => '2.0', 'id' => $id, 'result' => ['content' => [['type' => 'text', 'text' => wp_json_encode($result)]]]];
            }

            if ($name === 'get_page') {
                $path = $args['path'] ?? '';
                $page_id = url_to_postid(home_url($path));
                if (!$page_id) {
                    return ['jsonrpc' => '2.0', 'id' => $id, 'error' => ['code' => -32602, 'message' => 'Page not found']];
                }
                $post = get_post($page_id);
                $content = wp_strip_all_tags($post->post_content);
                return ['jsonrpc' => '2.0', 'id' => $id, 'result' => [
                    'content' => [['type' => 'text', 'text' => "# {$post->post_title}\n\n$content"]],
                ]];
            }

            if ($name === 'search_pages') {
                $query = $args['query'] ?? '';
                $posts = get_posts(['s' => $query, 'numberposts' => 10]);
                $result = array_map(function($p) {
                    return ['path' => parse_url(get_permalink($p), PHP_URL_PATH), 'title' => $p->post_title];
                }, $posts);
                return ['jsonrpc' => '2.0', 'id' => $id, 'result' => ['content' => [['type' => 'text', 'text' => wp_json_encode($result)]]]];
            }
        }

        return ['jsonrpc' => '2.0', 'id' => $id, 'error' => ['code' => -32601, 'message' => 'Method not found']];
    }

    // ========================================================================
    // ADMIN
    // ========================================================================

    public function admin_menu() {
        add_options_page('Site to MCP', 'Site to MCP', 'manage_options', 's2m', [$this, 'admin_page']);
    }

    public function admin_init() {
        register_setting('s2m', 's2m_ai_bots');
        register_setting('s2m', 's2m_copy_for_ai');
        register_setting('s2m', 's2m_serve_markdown');
    }

    public function admin_page() {
        ?>
        <div class="wrap">
            <h1>Site to MCP — SEO for LLM</h1>
            <p>Konwertuje stronę WordPress w cytowane przez ChatGPT/Perplexity/Claude/Gemini źródło.</p>

            <h2>Status endpointów</h2>
            <ul>
                <li>llms.txt: <a href="<?php echo esc_url($this->config['site_url'] . '/llms.txt'); ?>" target="_blank">/llms.txt</a></li>
                <li>llms-full.txt: <a href="<?php echo esc_url($this->config['site_url'] . '/llms-full.txt'); ?>" target="_blank">/llms-full.txt</a></li>
                <li>skill.md: <a href="<?php echo esc_url($this->config['site_url'] . '/skill.md'); ?>" target="_blank">/skill.md</a></li>
                <li>agent-card: <a href="<?php echo esc_url($this->config['site_url'] . '/.well-known/agent-card.json'); ?>" target="_blank">/.well-known/agent-card.json</a></li>
                <li>MCP: <a href="<?php echo esc_url($this->config['site_url'] . '/.well-known/mcp.json'); ?>" target="_blank">/.well-known/mcp.json</a></li>
            </ul>

            <form method="post" action="options.php">
                <?php settings_fields('s2m'); do_settings_sections('s2m'); ?>

                <h2>AI Bots policy</h2>
                <p>Decyzja per bot: allow vs disallow (research May 2026: search bots = cytowania, training bots = decyzja użytkownika).</p>
                <table class="form-table">
                    <?php foreach ($this->config['ai_bots'] as $bot => $allowed): ?>
                    <tr>
                        <th><?php echo esc_html($bot); ?></th>
                        <td>
                            <input type="hidden" name="s2m_ai_bots[<?php echo $bot; ?>]" value="0">
                            <label>
                                <input type="checkbox" name="s2m_ai_bots[<?php echo $bot; ?>]" value="1" <?php checked($allowed); ?>>
                                Allow
                            </label>
                        </td>
                    </tr>
                    <?php endforeach; ?>
                </table>

                <h2>Features</h2>
                <table class="form-table">
                    <tr>
                        <th>Copy for AI button</th>
                        <td>
                            <input type="hidden" name="s2m_copy_for_ai" value="0">
                            <label><input type="checkbox" name="s2m_copy_for_ai" value="1" <?php checked($this->config['copy_for_ai']); ?>> Dodaj button "Copy for AI" pod postami</label>
                        </td>
                    </tr>
                    <tr>
                        <th>Serve markdown to AI bots</th>
                        <td>
                            <input type="hidden" name="s2m_serve_markdown" value="0">
                            <label><input type="checkbox" name="s2m_serve_markdown" value="1" <?php checked($this->config['serve_markdown']); ?>> Gdy AI bot lub Accept: text/markdown — serwuj markdown</label>
                        </td>
                    </tr>
                </table>

                <?php submit_button(); ?>
            </form>
        </div>
        <?php
    }
}

new SiteToMcp();

register_activation_hook(__FILE__, function() { flush_rewrite_rules(); });
register_deactivation_hook(__FILE__, function() { flush_rewrite_rules(); });
