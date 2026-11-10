# MARKETING SITE KNOWLEDGE BASE

## OVERVIEW

Astro 5 marketing site (wonder.money) with React 19 islands, Tailwind 4, Sanity-backed
content, and application/API seams. Node 26 (root `.nvmrc`) and pnpm from the repository
root; `pnpm dev:landing` at the root starts it. It has six locale-prefixed route trees
(`pt`, `en`, `es`, `fr`, `de`, `it`), with `pt` as the default locale. Deployed through
Vercel's Git integration as SSR output (`@astrojs/vercel`); localized pages are largely
prerendered.

## STRUCTURE

```text
src/pages/             # Root redirect plus 15 mirrored pages per locale
src/components/pages/  # Shared page archetypes/composition
src/components/shared/ # Layout, SEO, structured data
src/lib/               # Locale, routes, static paths, Sanity clients
src/content/           # Local content/config
src/locales/           # Translation catalogues (mirrored in public/locales/)
scripts/               # Offer and claims alignment checks
public/                # Static assets
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Route parity | `src/pages/`, "Localized routes" below | Thin locale wrappers |
| Localized URLs | `src/lib/routes.ts` | Typed localized slug map |
| Static content expansion | `src/lib/pageStaticPaths.ts` | Guides, glossary, tools, monthly pages |
| Page composition | `src/components/pages/` | Shared across locales |
| Global document/SEO | `src/layouts/Layout.astro`, `src/components/shared/SEO.astro` | Canonical and alternate links |
| Visual rules | `DESIGN.md` | Tokens shared with `apps/web/DESIGN.md` |
| Redirects | `vercel.json` | Host-scoped 301s for retired pages |

## CONVENTIONS

- Keep localization structural and typed: locale values and route maps use literal types/`satisfies`.
- Locale page files remain thin; shared behavior belongs in route/static-path helpers or page archetypes.
- Hydrate React islands only when interaction requires it; prefer Astro/server-rendered markup otherwise.
- Preserve canonical URLs, hreflang alternates, structured data, and localized slugs together.
- Public claims and the offer are guarded: `src/lib/claimsAlignment.test.ts` and
  `scripts/check-offer-alignment.mjs` (both run by `pnpm test`) fail on unsupported product
  claims or a stale offer in any locale.
- Follow nearby formatting: this app has no Prettier config and existing Astro/TS style is mixed.
- Analytics IDs in `src/lib/gtm.ts` and `src/lib/posthog.ts` are public client keys, and
  the Sanity project id in `astro.config.mjs` is public too. Secrets stay in Vercel environment
  variables, never in code.

## LOCALIZED ROUTES

Ninety localized Astro routes: 15 mirrored pages for each of the six locales, plus the root
redirect to `/pt`.

```text
src/pages/{locale}/index.astro
src/pages/{locale}/features/[feature].astro
src/pages/{locale}/tools/[tool].astro
src/pages/{locale}/learn/[slug].astro
src/pages/{locale}/glossary/[slug].astro
src/pages/{locale}/...        # Same route surface in every locale
src/pages/index.astro         # Root redirect only
```

- Locale wrappers select locale and shared page archetype; keep content lookup and business logic out of route files.
- Static/dynamic path expansion belongs in `src/lib/pageStaticPaths.ts`; localized slug definitions belong in `src/lib/routes.ts`.
- Localized routes normally export `prerender = true`; preserve intentional exceptions explicitly.
- Add/remove/rename a route across all six locale trees and update route-symmetry tests in the same change.
- Preserve the `/` to `/pt` redirect unless the default-locale policy changes deliberately.
- Paid-traffic landing pages under `/{locale}/go/` are `noindex,follow` and kept out of the sitemap.
- Verify generated URLs for all six locales, not only the default route.

## ANTI-PATTERNS

- Never add a page to one locale tree only.
- Never duplicate route/content fetching logic across six wrappers.
- Never copy full page markup into locale wrappers or translate slugs outside the typed route table.
- Never silently omit missing Sanity content for one locale without an explicit fallback policy.
- Never assume `output: server` means localized pages are runtime-only; they explicitly prerender.
- Never put Markdown or other non-route files under `src/pages/`: Astro publishes them as pages.

## COMMANDS

```bash
pnpm dev
pnpm type-check   # astro check
pnpm lint         # ESLint, read-only; pnpm lint:fix applies fixes
pnpm test         # Vitest plus the offer alignment check
pnpm build
```

CI runs type-check, lint, test and build with the rest of the workspace.
