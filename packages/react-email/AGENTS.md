# @wondermoney/react-email

Email templates (React Email) that the API renders and sends. A private workspace package: the
API depends on it as `workspace:*` and imports the built `dist/`, so run `pnpm build:lib` (or
the root `pnpm build:lib`) after changing `src/`.

**This package does not send email.** No queries, schedules, webhooks or provider calls live
here. Sending, subjects, triggers and the transport (Resend, SMTP or the log driver) belong to
the API (`apps/api/src/services/email/`, `apps/api/src/jobs/`); check there before adding a
template so it does not duplicate an existing send.

## Layout

- `src/`: the library the API imports (`src/templates/`, render functions).
- `emails/`: preview entries for the playground (`pnpm dev`).
- `scripts/`: render, handoff and package checks.

## Commands

```bash
pnpm dev             # preview playground
pnpm run check       # typecheck, render every template, validate tracking/UTM/content, library checks
pnpm build:lib       # compile the library to dist/
pnpm check:package   # validate the packed dist/ in an isolated consumer
pnpm export          # render HTML + TXT to out/
pnpm build           # build the preview playground (what its deployment runs)
```

Run `pnpm run check` before calling a template change done.

## Conventions

- `react-email` (components and the `email` CLI) stays a **devDependency**: tsup inlines the
  components into `dist/index.js`, so the API's production install never gets the CLI or its
  esbuild. Only what `dist` imports at runtime (`@react-email/render`, `react`, `react-dom`)
  belongs in `dependencies`.
- Copy is PT-PT, some templates also EN. Keep terminology consistent with the docs site
  glossary (`apps/docs/content/docs/pt/glossary.mdx`). Never promise a feature that is not live.
- PT copy addresses the reader as **tu** ("Recebes este email porque…", "a tua conta"), never
  "você" or the formal third person (`CONTRIBUTING.md` has the rule and examples).
- `PreviewProps` use fictional names and values only.
- Placeholders such as `[[UNSUB_LINK_PT]]` are resolved by the API before sending.
- CTA, settings, privacy and unsubscribe URLs are absolute `https:` links.
