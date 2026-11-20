# WonderMoney marketing site

The public site at [wonder.money](https://wonder.money): Astro 7 with React 19 islands and
Tailwind 4. Content is composed from local configuration and Markdown in `src/content/`. Six
locale-prefixed route trees: `pt`, `en`, `es`, `fr`, `de` and `it`; Portuguese (`pt`) is the
default.

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
- `src/lib/`: locale, routes, static paths and the content collection readers
- `src/content/`: the learn content, one Markdown file per document and locale, and local
  content modules
- `public/`: static assets

## Learn content

Guides, glossary terms and monthly items live in
`src/content/<guides|glossary|monthly>/<locale>/<slug>.md`: the directory is the locale, the
file name is the URL slug, the frontmatter follows `src/content/schemas.ts` and the Markdown
body is the article. To add one, copy a file from the same collection and locale, rename it to
the new slug, edit it, and add its translation (en and pt hold the same documents). Never rename
a published slug: it is the page's address. `pnpm test` validates every file.

See `AGENTS.md` for conventions and `DESIGN.md` for the design contract.
