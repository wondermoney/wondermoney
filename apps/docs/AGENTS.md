# DOCUMENTATION SITE KNOWLEDGE BASE

## OVERVIEW

Next.js 16/Fumadocs 16 site with React 19 and MDX content, `en`, `pt`, and `es`
locales (`en` is default), and generated search/LLM/OG endpoints. Node 26 (root `.nvmrc`)
and pnpm from the repository root; `pnpm dev:docs` at the root starts it.

Next.js has breaking changes since most training data. Before writing Next-specific code, read the guide for the installed version in `../../node_modules/next/dist/docs/` (the install is hoisted to the repository root). `agentRules: false` in the Next config stops `next dev` from adding its own copy of this note to this file.

## STRUCTURE

```text
app/[lang]/docs/       # Fumadocs layout and catch-all content page
app/api/search/        # Search endpoint
app/llms*.{txt,mdx}/   # LLM-readable content endpoints
app/og/                # Generated Open Graph images
app/(legal)/           # en legal pages; (legal-pt) and (legal-es) mirror them
content/docs/          # Paired en, pt, and es MDX content
lib/source.ts          # Shared Fumadocs loader
lib/metadata.ts        # Canonical/hreflang helpers
lib/schema.ts          # Structured data
proxy.ts               # Next 16 request gate/rewrites, not middleware.ts
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Documentation content | `content/docs/AGENTS.md` | Locale parity and MDX rules |
| Content loader | `lib/source.ts`, `source.config.ts` | Feeds docs/search/LLM/OG |
| Request rewrites | `proxy.ts` | Legal-page pass-through, `/en/about/*` redirect, Markdown requests |
| SEO | `lib/metadata.ts`, `lib/schema.ts`, `app/sitemap.ts` | Canonical, hreflang, JSON-LD |
| Screenshots | `content/docs/AGENTS.md`, `scripts/capture-screens.ts`, `scripts/crop-screens.ts` | Image conventions; `docs/brand-checklist.md` for visuals |

## CONVENTIONS

- Documentation voice is calm, precise, and non-promotional: no hype, emoji, exclamation-heavy copy, gradients, badges, or generic illustrations.
- Use screenshots and flow diagrams when they clarify behavior; keep legal/product claims aligned with canonical root documents.
- `proxy.ts` is the request interception entry. Preserve the legal-page pass-through (and the `/en/about/<page>` → `/about/<page>` redirect) and explicit Markdown/`Accept: text/markdown` rewrites.
- The legal pages exist in all three locales and are **not** Fumadocs content — they are route groups under `app/`. A change to one must be mirrored in the other two, and each carries a governing-language clause naming the English version as authoritative.
- The Privacy Policy's sub-processor list is a GDPR Article 13/14 disclosure, not copy. `content/sub-processors.json` is its source of truth and `pnpm check:sub-processors` diffs it against all three locale documents in both directions. Adding a third party that touches customer data (anywhere in `apps/api`, `apps/web`, the marketing site or here) means adding it there and disclosing it in all three locales.
- `pnpm lint` deliberately runs that check as well as ESLint, because CI runs `lint`. If it ever moves, it must stay in something CI runs: a disclosure guard nobody executes is the failure it exists to prevent.
- `lib/source.ts` is shared by pages, search, Markdown/LLM output, and OG generation; content-shape changes affect all surfaces.
- `.source` and generated collection/types output are build products; regenerate through scripts instead of hand-editing.

## ANTI-PATTERNS

- Never add `middleware.ts` beside `proxy.ts` for the same routing concern.
- Never edit generated Fumadocs collections or Next type output.
- Never ship a locale-specific content change without checking its paired document and navigation metadata.
- Never bypass metadata helpers with one-off canonical/hreflang/schema implementations.

## COMMANDS

```bash
pnpm dev
pnpm type-check   # Regenerates MDX and Next types before tsc
pnpm lint         # ESLint plus the sub-processor, locale-parity and rule-presets checks
pnpm build
```

There is no test suite; CI runs type-check, lint and build. `NEXT_PUBLIC_SITE_URL`
controls public canonical URL generation.
