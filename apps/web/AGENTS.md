# WonderMoney web

Next.js 16 App Router on React 19.3.0, Tailwind CSS 4, next-intl. Node 26 (root `.nvmrc`) and
pnpm from the repository root. The scripts are in `package.json`; CI runs `type-check`, `lint`,
`test` and `build` (`next build --webpack`) through Turborepo, plus a Cypress smoke lane.

Next.js has breaking changes since most training data. Before writing Next-specific code, read
the guide for the installed version in `../../node_modules/next/dist/docs/` (the install is
hoisted to the repository root). `agentRules: false` in the Next config stops `next dev` from
adding its own copy of this note to this file.

## Sources of truth

- **Visual and interaction rules: `DESIGN.md`** (tokens, typography, components, do's and
  don'ts). `DESIGN_HISTORY.md` holds the numbered data-presentation rules that code comments
  cite ("rule 3"); `DESIGN.md` wins where they disagree. Tokens live in `theme/globals.css`;
  there is no Tailwind config file.
- All data comes from the API over HTTP; web has no database access. Never import API source:
  the `@api/*` path in `tsconfig.json` is unused and must stay that way.

## Where to look

| Task | Location |
|---|---|
| Routes, layouts, providers | `app/AGENTS.md` |
| Shared UI primitives | `components/ui/AGENTS.md` |
| API hooks, query keys, mutations | `lib/api/AGENTS.md` |
| Feature UI | `components/{domain}/` |
| Auth | `lib/auth/`, `proxy.ts` |
| Translations | `messages/{en,pt,es}/*.json`, registered in `i18n/` |
| Environment | `.env.example` (copy to `.env.local`) |

## Auth model

better-auth runs inside the API; web uses `authClient` (`lib/auth/client.ts`, base URL
`NEXT_PUBLIC_API_URL`) for every client-side flow. Sessions are opaque cookies, shared across
subdomains when `NEXT_PUBLIC_AUTH_COOKIE_DOMAIN` is set.

- `proxy.ts` → `lib/auth/middleware.ts#updateSession` does i18n routing and an **optimistic**
  redirect on session-cookie presence only (`getSessionCookie`, no network call). It is UX,
  not authorization; keep it free of network round-trips.
- `requireServerAuth` (`lib/auth/server-auth.ts`) is the one **authoritative** check: a
  `cache()`-wrapped call to `/api/auth/get-session`. `getServerApi()` (`lib/api/api-server.ts`)
  and the `(full-layout)` layout gate on it. A rejected stale cookie redirects to login with
  `reason=session-expired`, and the middleware clears the cookies (`lib/auth/stale-session.ts`).
- A single transient 401, or an analytics or storage failure, never logs the user out.

## Conventions

- Server Components by default; `"use client"` only for hooks, interaction or browser APIs.
- Server state in React Query, navigable filters in the URL, UI-only state in Zustand (`store/`),
  forms in React Hook Form + Zod.
- `@/*` imports. Merge classes with `cn()`; variants with `cva`.
- All customer-facing copy goes through next-intl, in **en, pt and es**; the
  i18n-message-key check in `pnpm test` enforces key parity.
- Financial values: `font-mono`, locale-aware formatting (`lib/utils/formatCurrency.ts`,
  `formatDate.ts`), and a non-color cue beside every gain/loss color.
- Calm, data-first UI: semantic tokens only; no emoji, promotional badges, generic
  illustrations or decorative gradients. Accessible labels and focus, keyboard access, 44px
  mobile targets.
- Tables are TanStack Table v9: import `ColumnDef`, `Row`, `Table`, `createColumnHelper` from
  `components/ui/Table/features.ts`, not from `@tanstack/react-table`. Charts are Recharts
  through `components/ui/chart.tsx`.
- `pnpm lint` is check-only with zero warnings; `pnpm lint:fix` and `pnpm format` write files.

## Households

A tenant is a household (owner plus one partner, joined at signup by invite). Web pieces:
`lib/api/household/`, `components/settings/Household.tsx`, the `/join` page
(`app/[locale]/(no-layout)/join/`; `inviteToken` rides through signup into `/v1/auth/callback`).
Private accounts: the owner-only "Private account" switch sends `isPrivate` only when the
viewer owns the account; members never receive private accounts from the API.

## Tests

`pnpm test` is the whole Vitest suite: every `*.test.ts(x)`, mostly written with `test` from
`vitest` and `node:assert/strict`. Tests assert behaviour (render it, call it); never read source
text off disk. Narrow a run by path (`pnpm test lib/budget`), never with Vitest's `-t`, which
exits 0 when it matches nothing.
TDD is optional here; validate UI changes by running the app.

**Cypress runs against a local stack, never staging or production.** The smoke specs need only
the web dev server (`pnpm e2e:headless`). The portfolio-import lane needs a disposable local
Postgres, API, worker and S3-compatible store, set up as in `docs/qa/worktree-e2e.md`
(`pnpm e2e:worktree:preflight` first; the API is expected on `http://localhost:3001`). Pass
environment on the command line, not through a `.env` that may point at a shared database.
`cypress/support/better-auth.ts` signs up through `/api/auth/sign-up/email` and provisions the
user with `POST /v1/auth/callback`. Use a fresh `test+<uuid>@...` account per run.

`pnpm qa:smoke` (`scripts/e2e-smoke-agent-browser.sh`) drives a real browser against a live
deployment (`WM_BASE_URL`, `WM_EMAIL`, `WM_PASSWORD`) with an existing account; its header
documents the quirks it works around.
