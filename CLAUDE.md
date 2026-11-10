# WonderMoney monorepo

Free, open-source, self-hostable personal finance. One pnpm workspace with Turborepo:

| Path | What | Notes |
|---|---|---|
| `apps/api` | Express/MikroORM API and pg-boss worker | Its `CLAUDE.md` holds the database safety rules: read it before any DB command |
| `apps/web` | Next.js 16 web app | Builds with webpack (`next build --webpack`) |
| `apps/mobile` | Expo SDK 58 app | React Native 0.88 needs React exactly 19.3.0 |
| `apps/docs` | Fumadocs site (docs.wonder.money) | en, pt and es pages must stay in step |
| `packages/shared` | EODHD client, CSV/broker parsers | Private workspace package, `build:lib` |
| `packages/react-email` | Email templates the API renders | Private workspace package, `build:lib` |

Each app and package has its own agent guide (`CLAUDE.md` in `apps/api`, `AGENTS.md`
elsewhere, with the other file pointing to it); it applies inside that directory. Visual and
interaction rules for the clients are in `apps/web/DESIGN.md` and `apps/mobile/DESIGN.md`;
issues and pull requests are on GitHub (`CONTRIBUTING.md`).

## Commands

Run from the repository root with Node 26 LTS (`.nvmrc`; Expo tooling in `apps/mobile` stays on
Node 24, `apps/mobile/.nvmrc`) and pnpm. Node 25+ no longer bundles corepack, so install it once:
`npm install -g corepack && corepack enable`.

```bash
pnpm install
pnpm build:lib                       # the two packages the API imports
pnpm type-check && pnpm lint && pnpm test
pnpm --filter @wondermoney/api <script>   # anything app-specific
```

Turborepo runs a task only in packages that define it. `build` depends on `build:lib`.

## Workspace rules

- **One React for everything: 19.3.0**, pinned by a `pnpm-workspace.yaml` override. The
  install is hoisted (`nodeLinker: hoisted`) because Expo's circular peer dependencies split
  the isolated layout, and a hoisted install can't give shared libraries two Reacts. Move
  React (and `react-native-reanimated`, `react-native-worklets`) only together with the Expo
  SDK.
- New dependencies with install scripts must be listed under `allowBuilds` in
  `pnpm-workspace.yaml`.
- `.pnpmfile.cjs` drops better-auth's optional next/expo peers so they stay out of the API's
  production closure and image. Every Dockerfile that runs `pnpm install` copies it.
- Never import another app's source; `packages/*` are the shared code.
- Commit messages through a file (`git commit -F`) or a quoted heredoc: backticks inside a
  double-quoted `-m` are executed by the shell.

## Branches

- `develop` is the default branch: open pull requests against it. `main` is the release
  branch; maintainers promote `develop` to it once CI has passed on `develop`'s head. Never
  push to `main` directly.
- The API applies pending migrations when it starts. Take a database backup before
  releasing a constraint-changing or destructive migration.
- Maintainers deploy the hosted instance separately; its hostnames, resource names and
  runbooks are not part of this repository. Keep internal hostnames, IPs, credentials and
  resource names out of code, docs and fixtures, and use neutral names in test data.
