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

- Node.js `v24` from `.nvmrc`
- pnpm, from the repository root (`packageManager` in the root `package.json`)

## Setup

```bash
cp .env.example .env.local
pnpm install --frozen-lockfile
```

Fill in the required environment variables in `.env.local` by name only.

Environment variable names:

- `SENTRY_IGNORE_API_RESOLUTION_ERROR`
- `NEXT_PUBLIC_TAWK_HASH`
- `NEXT_PUBLIC_TAWK_PROPERTY_ID`
- `NEXT_PUBLIC_TAWK_WIDGET_ID`
- `NEXT_PUBLIC_POSTHOG_KEY`
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

- `CLAUDE.md`
- `../docs/BRAND_GUIDELINES.md`
- `../docs/UX_PLAYBOOK.md`
- `../docs/PRODUCT_SPEC.md`

## Testing notes

- Cypress specs live in `cypress/e2e`
- Regression scripts live in `scripts`
