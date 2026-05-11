# Contributing to site-to-mcp

Dzięki za zainteresowanie. Plugin jest open source MIT — chętnie przyjmiemy PR-y.

## Dev setup

```bash
git clone https://github.com/vidokstudio/site-to-mcp.git
cd site-to-mcp
npm install
npm run build
npm run test:smoke
```

Wymagane: Node ≥ 18.

## Filozofia projektu (krótka wersja)

- **Core jest runtime-agnostic.** Każdy moduł `core/*` działa w Node, Bun, Deno, Cloudflare Workers. Tylko build-time hooks (Astro adapter) dotykają `node:fs`.
- **Adaptery są thin.** Nie duplikuj logiki z core w adapterze.
- **Iron law: zero destruktywnych zmian** w autofix. Tylko dodajemy/oznaczamy/wrapujemy, nigdy nie usuwamy treści użytkownika.
- **Public API stable.** `src/types/index.ts` to single source of truth. Breaking changes = major bump.

## Workflow

1. Fork → branch z `main` (np. `feat/twoja-feature`)
2. Dodaj kod + testy w `tests/smoke.mjs` (lub osobny `tests/unit/X.test.mjs`)
3. `npm test` musi przejść (TypeScript build + smoke test)
4. Commit message: Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`)
5. PR z opisem motywacji + linki do issue (jeśli istnieje)

## Dodawanie nowego fixu w Autofixer

Każdy nowy fix MUSI mieć:

- **`id`** w formacie `LAYER-CATEGORY-NN` (np. `IDX-009`, `SCH-T2-Product`)
- **`citation`** — skąd wiemy że to działa (paper, study, official docs)
- **`risk`** — `'zero' | 'low' | 'medium' | 'high'` (decyzja konserwatywna)
- **Test w `tests/smoke.mjs`** — assert że fix jest proposowany w report z fixture

Przykład:

```ts
// W audit/index.ts
f.push({
  id: 'IDX-009',
  layer: 'indexability',
  status: 'warning',
  severity: 'medium',
  title: 'Brak meta charset',
  detail: '...',
  citation: 'WHATWG HTML5: charset musi być w pierwszych 1024 bajtach.',
  autofixable: true,
  autofix: {
    action: 'inject_meta',
    args: { tag: 'meta', name: 'charset', content: 'UTF-8' },
    risk: 'zero',
  },
});
```

## Dodawanie nowego schema type

1. Add function w `src/core/schema/templates.ts`:
   ```ts
   export function newSchemaType(input: NewSchemaInput): Record<string, unknown> { ... }
   ```
2. Add do `SchemaType` union w `src/types/index.ts`
3. Add do switch w `buildSchemaBundle()` w `src/core/schema/index.ts`
4. **Manual check** w Google Rich Results Test: https://search.google.com/test/rich-results
5. Add do `templates/schema/tierN-newtype.json` jako template reference
6. Update CHANGELOG.md

## Dodawanie nowego adaptera

1. Stwórz `src/adapters/<framework>/index.ts`
2. Importuj z `core/*`, NIE duplikuj logiki
3. Add subpath export w `package.json` → `exports`
4. Add do peerDependencies (jeśli framework ma npm package) + `optional: true`
5. Update README.md tabelka frameworków
6. Add example w `examples/<framework>-demo/`

## Bezpieczeństwo

Jeśli znajdziesz lukę bezpieczeństwa **NIE** zgłaszaj jej publicznie. Email: `nicolas@vidok.studio` z prefix `[SECURITY]`. Dostaniesz odpowiedź < 48h.

Aktualne hardening:
- SSRF guard w `fetch-page.ts` (DNS lookup + private IP block). Wyłączane przez `S2M_DISABLE_SSRF_GUARD=1` na własne ryzyko.
- XSS-safe `toScriptTag` (escape `</script>`)
- CDATA injection guard w RSS generator
- WordPress: `esc_url`/`esc_attr`/`esc_html` everywhere + `str_replace('</', '<\/')` w JSON-LD
- MCP rate limit + Bearer auth via `checkRateLimit()` / `checkAuth()` helpers (adapter integration required)

## Code style

- TypeScript strict (`noUncheckedIndexedAccess`, `noImplicitOverride`)
- ESM only (`"type": "module"`)
- Funkcyjne API > class-based (factory tylko gdzie state lifecycle)
- Polskie komentarze w core OK (Nicolas dev). Angielskie w public API exports.
- Bez emoji w kodzie (chyba że console output user-facing)

## Co NIE accept'ujemy

- Dependency bloat (>3 nowe deps bez uzasadnienia)
- Breaking changes bez RFC issue
- Adapter który wykonuje JS w runtime (LLM go i tak nie zobaczy)
- Schema templates bez Rich Results Test validation
- Fix bez `risk` declaration
- CSS-in-JS jakichkolwiek browserish styling decisions w core

## License

By contributing you agree your code will be licensed under MIT (same as project).
