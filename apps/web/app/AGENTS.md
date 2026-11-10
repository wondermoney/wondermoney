# APP ROUTER KNOWLEDGE BASE

## OVERVIEW

Locale-aware Next.js App Router boundary. Framework entries replace a conventional `main`: layouts, pages, route handlers, metadata, and providers compose the runtime.

## STRUCTURE

```text
layout.tsx                 # Required pass-through root layout for root not-found
[locale]/layout.tsx        # Real document root, fonts, intl, providers, analytics
[locale]/(full-layout)/    # Authenticated, onboarded product shell
[locale]/(no-layout)/      # Auth, callbacks, onboarding, wizard shells
[locale]/**/route.ts       # OAuth and other HTTP handlers
api/, health/              # Non-localized handlers
providers.tsx              # Query, auth, analytics, theme, notifications
```

## CONVENTIONS

- Validate locales against `i18n/routing.ts`, call `setRequestLocale`, and keep all product pages locale-prefixed.
- Keep the root `app/layout.tsx`; root `not-found.tsx` requires it even though the localized layout owns `<html>`/`<body>`.
- Full-layout routes pass through server auth and first-run onboarding gates before rendering chrome.
- Fetch server data in Server Components/server helpers and hydrate only where client interactivity needs React Query.
- Create a new QueryClient per server request and reuse one cached browser client. Keep provider ordering deliberate.
- Keep OAuth/auth route redirects, locale, MFA state, and better-auth session cookies together.
- Route handlers return explicit status/body shapes and keep secrets/server clients off client bundles.

## ANTI-PATTERNS

- Never add `"use client"` to a layout/page solely to simplify data access.
- Never bypass the full-layout auth gate for a protected page.
- Never remove the root layout or duplicate the document root outside `[locale]/layout.tsx`.
- Never initialize provider state in a way that recreates QueryClient during suspended renders.
- Never add a public route without reconciling middleware redirect behavior.

## VERIFICATION

```bash
pnpm type-check
pnpm lint
pnpm test
```

`pnpm test` is the whole Vitest suite. To iterate while you work, narrow it by path (`pnpm test app/budgets`), but push on the full run.
