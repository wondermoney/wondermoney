# WonderMoney Web

Next.js 16 frontend for WonderMoney.

## Tech stack

- TypeScript
- React 19
- Tailwind CSS v4
- next-intl
- React Query
- better-auth
- Sentry
- PostHog

## Prerequisites

- Node.js `v26` from `.nvmrc`
- pnpm, from the repository root (`packageManager` in the root `package.json`)

## Setup

```bash
cp .env.example .env.local
pnpm install --frozen-lockfile
```

Fill in the required environment variables in `.env.local` by name only.

Environment variable names:

- `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_APP_URL`
- `NEXT_PUBLIC_SENTRY_DSN`
- `SENTRY_IGNORE_API_RESOLUTION_ERROR`
- `NEXT_PUBLIC_POSTHOG_KEY` and `NEXT_PUBLIC_GTM_ID` (optional: each turns on its tracker;
  unset, none loads)
- `NEXT_PUBLIC_RECAPTCHA_SITE_KEY`
- `RECAPTCHA_SECRET_KEY`

## Common commands

- `pnpm dev`
- `pnpm type-check`
- `pnpm lint`
- `pnpm test`
- `pnpm e2e:headless`
- `pnpm build`

## Architecture pointers

- `AGENTS.md` (`CLAUDE.md` points to it)
- `DESIGN.md`
- `docs/qa/worktree-e2e.md`

## Testing notes

- Cypress specs live in `cypress/e2e`
- Regression scripts live in `scripts`
