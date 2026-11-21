# The analytics event catalogue

`catalogue.ts` lists every product analytics event WonderMoney sends, from the API, the web
app and the mobile app. The clients are typed by it, so an event or property that is not in it
does not compile; `docs/analytics-events.md` is generated from it. Epic #628 has the reasoning.

## Adding or changing an event

Edit `catalogue.ts` in a pull request, then regenerate the page:

```bash
pnpm --filter @wondermoney/shared analytics-events
```

`tests/analytics/` checks every entry against the rules below, and fails when the page is stale.

## The rules

- **An event answers a question**: activation, retention, bank connection health or imports
  (`question`). An event no question needs is not added.
- **Names are `thing_happened`**: snake_case, ending in a past tense (`budget_created`,
  `bank_connection_failed`). Never named after the interface: no `_modal`, `_button`,
  `_table`, `_row`, `_clicked`, `_tab` or `_page`.
- **Properties are a fixed list of values, a boolean or a count.** Never a database
  identifier, an email, a name, an amount or a balance, free text, a path or an object. A
  property name ending in `id`, `key` or `ids`, or naming an email, name, amount or balance,
  fails the tests.
- **Facts on the server, intent in the client.** Anything the API commits (an account, a
  budget, a goal, an import, a bank connection) is a `service` event sent from `server`. A
  client sends only what the server can't see: a screen viewed, a flow started, abandoned or
  failed before it reached the API.
- **The tier follows the surface**: `server` events are `service`, `web` and `mobile` events
  are `behavioural`. One event is never both.
- The same step on web and mobile is one event with both surfaces, so a question can be
  answered across platforms.

## Where it is used

| Surface | Boundary                                                                           |
| ------- | ---------------------------------------------------------------------------------- |
| Web     | `apps/web/lib/analytics/track.ts`; a lint rule bans `posthog.capture` elsewhere    |
| Mobile  | `apps/mobile/src/lib/telemetry/analytics.ts` (`apps/mobile/docs/telemetry-adr.md`) |
| API     | the analytics outbox (#624)                                                        |
