# Landing attribution: which free tools bring users

The wonder.money tools and curated resource lists are measured from the first visit to the
first budget or goal, per page, and every signup notes where its visit came from (an AI
assistant, search, social, direct or other). Every step is consent-gated, and none carries personal data.
The user-facing description is in the privacy policy (`apps/docs/app/(legal*)/**/privacy-policy`,
section "PostHog") and `apps/docs/content/docs/{en,pt,es}/settings-security-privacy/data-privacy.mdx`.

## The page's id

A tool or list page's **route id** (`toolMortgage`, `resourcePodcasts`; `ROUTE_SLUGS` in
`apps/landing/src/lib/routes.ts`) is its source, the same in every locale. `ToolDetailPage.astro`
and `CuratedListPage.astro` pass it to the layout as `landingSource`, which puts it on
`<body data-landing-source>`.

## Where the visit came from

Every page also works out where the visit came from, as one coarse **referrer class**:
`ai_assistant`, `search`, `social`, `direct` or `other`
(`apps/landing/src/lib/referrerClass.ts`). It reads `utm_source` first (ChatGPT's answers link
with `utm_source=chatgpt.com`), then the referrer's hostname against a short allowlist: AI
assistants are `chatgpt.com`, `chat.openai.com`, `perplexity.ai`, `gemini.google.com`,
`copilot.microsoft.com` and `claude.ai`, and their Android apps; search engines and social
networks have lists of their own. No referrer and no `utm_source` is `direct`, anything else
`other`. A click from one page of the site to the next has no class of its own: the visit keeps
the class of its first page, which the browser keeps in `sessionStorage`
(`wondermoney.referrer-class`) once analytics is allowed, until the tab closes or the consent is
withdrawn. A visitor who allows analytics only after the first page has no class.

Only the class leaves that module. The referrer URL and the `utm_*` values are never put on a
link, stored with the class, or sent with the signup, and the account never holds any of them.

## The chain

| Step | Where | Event | Consent |
|---|---|---|---|
| Visit | website, PostHog | `$pageview` with `landing_source` and `referrer_class` | site **Analytics** |
| Use | website | `tool_used` (tools), `curated_list_viewed` and `curated_list_entry_click` (lists) | site **Analytics** |
| Next step | website | `cta_click` (`cta_position` `cta_banner` or `tool_result`) | site **Analytics** |
| Signup | API outbox | `signup` with `landing_source` and `referrer_class` | site **and** app analytics |
| Activation | API outbox | `first_budget_created`, `first_goal_created` | none: service events (keyed to the signup) |

- **Website** (`apps/landing/src/lib/landingSource.ts`, `posthog.ts`, `curatedListTracking.ts`).
  PostHog's `before_send` adds `landing_source` to every event a tool or list page sends, and
  `referrer_class` to every event of every page. As a link to the app's signup is followed
  (click, middle click, context menu), the page sets `?landing_source=<route id>` (tool and list
  pages) and `?referrer_class=<class>` (every page) on it if the visitor allowed analytics on the
  site at that moment, and takes both off otherwise. The only thing stored in the browser is the
  visit's referrer class, as above.
- **App** (`apps/web/lib/analytics/landing-source.ts`). The signup page forwards both
  parameters only when the app's own analytics opt-in is granted: in the `POST /v1/auth/callback`
  body for an email signup (`landingSource`, `referrerClass`), and through the `/auth/complete`
  callback URL for Google. The website's consent alone never records anything in the app.
- **API** (`validators/auth.ts`, `services/auth/signup-record.service.ts`,
  `services/analytics/service-events.service.ts`). `landingSource` must look like a route id and
  `referrerClass` must be one of the five classes (`ANALYTICS_REFERRER_CLASSES` in the analytics
  catalogue), else each is dropped (never a 400). They go on the `signup` outbox event only, never
  on the account. The first budget and the first goal a person creates each record one event
  (`first_budget_created`, `first_goal_created`, beside `budget_created` and `goal_created` for
  every one), keyed by the same distinct id (the account's external id) with an event id that
  repeats for later ones, so the outbox keeps only the first. A person who had accounts, budgets or
  goals before these events existed gets a "first" on their next one; the funnel counts only signups in its
  window, so they don't reach it. Like every outbox event, they exist only with
  `ANALYTICS_OUTBOX_MODE=live`, so a self-hosted server records none of this.

The app's PostHog keeps no identity across visits (memory persistence, no person profiles), so
the website's anonymous visitor and the new account are never joined as one person. The route
id is the join: the site's events are counted per id, and the account's events per the id on
its `signup` event.

## Signups from AI assistants

`referrer_class` answers how many signups each kind of source brings, AI assistants above all:
count `signup` events by `referrer_class`, and the site's `$pageview` events by the same property
for the visits. Like `landing_source`, it undercounts the signups against the visits by the share
of people who decline the app's opt-in, and it misses a visit whose analytics consent came after
its first page.

## The per-tool funnel

A PostHog SQL insight, one row per tool or list, over the last 90 days. Entrances are page views
arriving from outside the site (search, other sites, direct). Activations count accounts with a
first budget or goal, at any time after their signup in the window.

The query is [`docs/analytics/landing-funnel.sql`](analytics/landing-funnel.sql), on the
product dashboard (`docs/analytics/README.md`).

Read it with the consent in mind: a signup counts only when the visitor allowed analytics on
both sites, so signups and activations undercount against the site's columns, by roughly the
share of new users who decline the app's opt-in.

## Changing it

- A new tool or list needs nothing: its route id flows from the page archetype.
- A new signup path in the app (another sign-in provider, a page other than `/auth/signup`)
  forwards `getConsentedLandingSource(searchParams)` the same way `SignupForm.tsx` does.
- Keep the route id and the referrer class the only things the link carries: no visitor data,
  no free text, never the referrer or a campaign value. The API's `LANDING_SOURCE_PATTERN` and the
  web's copy of it must stay in step; the referrer classes are the catalogue's
  `ANALYTICS_REFERRER_CLASSES`, which the API and the web import and the website copies
  (`REFERRER_CLASSES`).
- A new AI assistant, search engine or social network is a hostname (or `utm_source` name) in
  `referrerClass.ts`, with a case in `referrerClass.test.ts`.
