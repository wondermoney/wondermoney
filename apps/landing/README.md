# WonderMoney marketing site

The public site at [wonder.money](https://wonder.money): Astro 7 with React 19 islands and
Tailwind 4. Content is composed from local configuration and Sanity. Six locale-prefixed
route trees: `pt`, `en`, `es`, `fr`, `de` and `it`; Portuguese (`pt`) is the default.

## Development

From the repository root, with Node 26 and pnpm (see the root README):

```bash
pnpm install
pnpm dev:landing
```

Checks, from this directory:

```bash
pnpm type-check
pnpm lint
pnpm test
pnpm build
```

The build is Vercel SSR output (`@astrojs/vercel`); localized pages are prerendered.

## Structure

- `src/pages/`: mirrored locale route wrappers
- `src/components/pages/`: shared page compositions
- `src/components/shared/`: layout, SEO and structured data
- `src/lib/`: locale, routes, static paths and Sanity clients
- `src/content/` and `public/`: local content/configuration and static assets

See `AGENTS.md` for conventions and `DESIGN.md` for the design contract.
