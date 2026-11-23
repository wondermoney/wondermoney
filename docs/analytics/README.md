# Product analytics dashboard

The four questions of the analytics epic (#628), answered from the events in
[`docs/analytics-events.md`](../analytics-events.md). Each file here is one SQL insight on the
dashboard in the hosted PostHog project, in the same order:

| Insight | Question | Query |
|---|---|---|
| Activation | Of last 90 days' signups, how many added an account, then a budget or goal, then came back in week 2, by platform and website page | [`activation.sql`](activation.sql) |
| Weekly active users | People active each week, by client | [`weekly-active-users.sql`](weekly-active-users.sql) |
| Retention by signup week | Share of each signup week active in its 4th and 12th week | [`retention.sql`](retention.sql) |
| Bank connections per week | Started, abandoned, completed and failed connections per week and provider | [`bank-connections.sql`](bank-connections.sql) |
| Bank connection failures | Why connections fail, by provider and step | [`bank-connection-failures.sql`](bank-connection-failures.sql) |
| Bank syncs per week | Syncs that succeeded, were retried, or ended partial or failed with no retry left | [`bank-sync-incidents.sql`](bank-sync-incidents.sql) |
| Bank sync incidents by cause | Why syncs end in an incident, by kind and code | [`bank-sync-failures.sql`](bank-sync-failures.sql) |
| Imports | Each import step and failure, by kind and format | [`imports.sql`](imports.sql) |
| Landing attribution | Per website tool or list: visits to signups and activations | [`landing-funnel.sql`](landing-funnel.sql) ([how it works](../landing-attribution.md)) |

The dashboard is **Product analytics** in the hosted PostHog project:
<https://eu.posthog.com/project/3621/dashboard/1142647>. Its tiles are grouped by question.

## Reading it

- **Two kinds of event.** Service events (`signup`, `user_active`, `first_*_created`,
  `bank_connection_completed` and `_failed`, `import_committed`, the sync events) come from the
  server for every account on the hosted instance that has not objected, keyed by the account's
  random external id. Behavioural events (`*_started`, `import_mapped`, `import_reviewed`,
  `import_failed`, `bank_connection_abandoned`) come from the apps only with the person's
  analytics opt-in, and carry no identity.
- **So only activation and retention follow people.** The bank connection and import insights
  count each step per week; a behavioural step undercounts against a service step by roughly the
  share of people who decline the opt-in, and the two can't be joined into one person's funnel.
- **Platform at signup** is the client of the person's first `user_active`, since `signup`
  itself carries none.
- **Weeks start on Monday**, in the project's timezone; `user_active` is once per UTC day.
- **Some tiles start empty.** `user_active` is recorded from 2026-11-22, so retention and the
  week-2 column fill in from then on (the queries show NULL rather than a false zero before it),
  and platform at signup is `unknown` for earlier signups. The bank connection and import events
  of #625 and #626 appear once those releases reach production.
- Events renamed by the catalogue are in the legacy tables at the end of
  `docs/analytics-events.md`, for an insight that reaches back before #625 and #626.

## Changing it

Edit the query here first, in a pull request, then paste it into the insight's SQL in PostHog.
Each query sets its own date window, so the dashboard's date picker does not change it. Keep a
`LIMIT` above the rows the query can return: PostHog shows only the first 100 rows without one.
A query names only events and properties in the catalogue; a new question that needs an event
the catalogue lacks starts with a catalogue change (`packages/shared/lib/analytics/README.md`).
