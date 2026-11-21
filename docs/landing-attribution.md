# Landing attribution: which free tools bring users

The wonder.money tools and curated resource lists are measured from the first visit to the
first budget or goal, per page. Every step is consent-gated, and none carries personal data.
The user-facing description is in the privacy policy (`apps/docs/app/(legal*)/**/privacy-policy`,
section "PostHog") and `apps/docs/content/docs/{en,pt,es}/settings-security-privacy/data-privacy.mdx`.

## The page's id

A tool or list page's **route id** (`toolMortgage`, `resourcePodcasts`; `ROUTE_SLUGS` in
`apps/landing/src/lib/routes.ts`) is its source, the same in every locale. `ToolDetailPage.astro`
and `CuratedListPage.astro` pass it to the layout as `landingSource`, which puts it on
`<body data-landing-source>`.

## The chain

| Step | Where | Event | Consent |
|---|---|---|---|
| Visit | website, PostHog | `$pageview` with `landing_source` | site **Analytics** |
| Use | website | `tool_used` (tools), `curated_list_viewed` and `curated_list_entry_click` (lists) | site **Analytics** |
| Next step | website | `cta_click` (`cta_position` `cta_banner` or `tool_result`) | site **Analytics** |
| Signup | API outbox | `signup` with `landing_source` | site **and** app analytics |
| Activation | API outbox | `first_budget_created`, `first_goal_created` | none: service events (keyed to the signup) |

- **Website** (`apps/landing/src/lib/landingSource.ts`, `posthog.ts`, `curatedListTracking.ts`).
  PostHog's `before_send` adds `landing_source` to every event a tool or list page sends. As a
  link to the app's signup is followed (click, middle click, context menu), the page sets
  `?landing_source=<route id>` on it if the visitor allowed analytics on the site at that
  moment, and takes it off otherwise. Nothing is stored in the browser.
- **App** (`apps/web/lib/analytics/landing-source.ts`). The signup page forwards the parameter
  only when the app's own analytics opt-in is granted: in the `POST /v1/auth/callback` body for
  an email signup, and through the `/auth/complete` callback URL for Google. The website's
  consent alone never records anything in the app.
- **API** (`validators/auth.ts`, `services/auth/signup-record.service.ts`,
  `services/analytics/service-events.service.ts`). `landingSource` must look like a route id,
  else it is dropped (never a 400). It goes on the `signup` outbox event only, never on the
  account. The first budget and the first goal a person creates each record one event
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

## The per-tool funnel

A PostHog SQL insight, one row per tool or list, over the last 90 days. Entrances are page views
arriving from outside the site (search, other sites, direct). Activations count accounts with a
first budget or goal, at any time after their signup in the window.

```sql
WITH
  site AS (
    SELECT
      properties.landing_source AS source,
      countIf(event = '$pageview'
        AND properties.$referring_domain NOT IN ('wonder.money', 'www.wonder.money')) AS entrances,
      countIf(event IN ('tool_used', 'curated_list_entry_click')) AS completions,
      countIf(event = 'cta_click'
        AND properties.cta_position IN ('cta_banner', 'tool_result')) AS next_step_clicks
    FROM events
    WHERE timestamp > now() - INTERVAL 90 DAY
      AND event IN ('$pageview', 'tool_used', 'curated_list_entry_click', 'cta_click')
      AND isNotNull(properties.landing_source)
    GROUP BY source
  ),
  signups AS (
    SELECT distinct_id, properties.landing_source AS source
    FROM events
    WHERE event = 'signup'
      AND timestamp > now() - INTERVAL 90 DAY
      AND isNotNull(properties.landing_source)
  ),
  app AS (
    SELECT
      source,
      count() AS signups,
      countIf(distinct_id IN (
        SELECT distinct_id FROM events
        WHERE event IN ('first_budget_created', 'first_goal_created')
      )) AS activations
    FROM signups
    GROUP BY source
  )
SELECT
  site.source AS source,
  site.entrances AS entrances,
  site.completions AS completions,
  site.next_step_clicks AS next_step_clicks,
  coalesce(app.signups, 0) AS signups,
  coalesce(app.activations, 0) AS activations
FROM site
LEFT JOIN app ON app.source = site.source
ORDER BY entrances DESC
```

Read it with the consent in mind: a signup counts only when the visitor allowed analytics on
both sites, so signups and activations undercount against the site's columns, by roughly the
share of new users who decline the app's opt-in.

## Changing it

- A new tool or list needs nothing: its route id flows from the page archetype.
- A new signup path in the app (another sign-in provider, a page other than `/auth/signup`)
  forwards `getConsentedLandingSource(searchParams)` the same way `SignupForm.tsx` does.
- Keep the route id the only thing the link carries: no visitor data, no free text. The API's
  `LANDING_SOURCE_PATTERN` and the web's copy of it must stay in step.
