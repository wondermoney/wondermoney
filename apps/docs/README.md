# WonderMoney documentation site

Next.js 16 and Fumadocs 16 documentation site using React 19 and MDX. It uses
Yarn `1.22.22`; CI runs on Node 22. The public site is `https://docs.wonder.money`.

## Local development

```bash
pnpm install
pnpm dev
```

Supported locales are `en`, `pt`, and `es`; `en` is the default. Documentation
content is paired across those locale trees. Useful checks are:

```bash
pnpm type-check
pnpm lint
pnpm build
```

`pnpm type-check` regenerates MDX and Next.js types before running TypeScript.
There is no test suite. Set `NEXT_PUBLIC_SITE_URL` when validating canonical,
sitemap, Open Graph, and JSON-LD URLs.

## Structure

- `app/[lang]/docs/` — localized Fumadocs layout and content routes
- `content/docs/` — localized MDX and section navigation
- `lib/source.ts` — shared source loader for docs, search, LLM, and OG surfaces
- `proxy.ts` — locale gate plus legacy legal and Markdown rewrites

See `AGENTS.md` and `content/docs/AGENTS.md` for active conventions. Deployment
steps are in `docs/deployment.md`.
