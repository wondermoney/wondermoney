# Mobile telemetry ADR: PostHog product analytics

**Status:** Approved (2026-08-12), as written, no edits. This unblocks the PostHog implementation
against exactly the allowlist below. It does not unblock the companion Sentry ADR
(`telemetry-adr-sentry.md`), which is a separate decision.

**Update (2026-08-14):** Decision 4's "local/staging-only" gate is superseded — `production` is
now an approved capture environment (`isAnalyticsCaptureApproved` in `analytics.ts`), per explicit
owner direction. The event/property allowlist below is unchanged and remains the actual guardrail;
only the environment gate widened. This means the App Privacy / Data Safety answers in
`secrets/store-compliance-answers.md` that declared "no diagnostics/usage data collected" are now
stale and must be corrected before the next store submission — PostHog is live in production.

## Why this exists

Earlier mobile tickets, and this document's own companion Sentry work, all cite the same
blocker: mobile has never had an approved answer to "what may we send to a third-party analytics
vendor." Every mobile ticket's "Analytics/error tracking" section has independently arrived at
the same instinct — allowlisted events only, no identifiers, no amounts, no free text — but
nothing has written that down as an actual, checkable rule until now.

## Web is not a safe template to copy

The PostHog work's own scope note said to match "web's existing PostHog usage where equivalent." Having
now read web's actual `posthog.capture(...)` call sites, that instruction needs a correction
before anyone implements against it:

- `app/[locale]/(no-layout)/auth/finish/page.tsx`: `posthog.identify(data.user.id, { email:
  data.user.email })` — sends a real email address as an identify trait.
- `components/account/AccountDeleteModal.tsx`, `BudgetDeleteModal.tsx`: `{ accountKey }` /
  `{ budgetKey }` — raw resource identifiers in event properties.
- `components/user/NordigenAccountUnsyncModal.tsx`: `{ requisitionKey: requisitionData.id }` —
  a bank-connection identifier.
- `components/account/AccountTransactionAddModal.tsx`, `PortfolioTransactionAddModal.tsx`:
  `posthog.capture("account_transaction_add", { data })` — the entire submitted transaction
  object, which can include amount, description, category, and date.

None of that is acceptable for mobile. Every mobile ticket written so far already says so
("no portfolio/asset/user identifiers, holdings, amounts or uploaded content"; "no
profile values, email, tenant IDs or support content"). This ADR makes that the actual
rule rather than a recurring aspiration, and mobile's event *names* may mirror web's for
comparability, but event *properties* never do by default — each property needs its own
justification below, not an inherited one.

## Decision

1. **Event names come from an explicit allowlist** (below). Adding an event means editing this
   document and getting it re-approved, not adding a `posthog.capture(...)` call and moving on.
2. **Properties are opt-in per event, not free-form.** Every property on every allowlisted event
   is enumerated below. No event may carry an arbitrary object, a raw database ID, an email, a
   name, an amount, a balance, a free-text field, or anything that round-trips to a specific
   account/portfolio/transaction/institution.
3. **No `identify()` call carries PII.** If user-level identification is needed at all (e.g. to
   dedupe a funnel across sessions), it uses the Supabase user ID alone — never email, never a
   display name — and needs its own sign-off line item below (currently: not approved; propose
   it explicitly if a real use case shows up).
4. **Local/staging-only until this ships to real users**, mirroring the existing gate pattern in
   `link-policy.ts` (`info.environment !== 'local' && info.environment !== 'staging'` — the
   approved support-mail channel already does this; the PostHog client should too, at minimum
   during initial rollout, so nothing reaches production analytics before this ADR's assumptions
   have been checked against real event volume).
5. **A scrub check is part of "done," not implied by this list.** The PostHog work's acceptance
   criteria already require a captured test event to be manually verified in the PostHog dashboard
   before it is done — this ADR doesn't relax that.

## Proposed initial event allowlist

Starting point, deliberately narrow — behavioral/funnel signal only, nothing that identifies a
person or their money. Strike, edit, or add rows before approving:

| Event | Properties | Rationale |
|---|---|---|
| `sign_up_completed` | `provider: 'email' \| 'apple' \| 'google'` | Funnel/channel-mix signal, no identity |
| `sign_in_completed` | `provider: 'email' \| 'apple' \| 'google'` | Same |
| `onboarding_completed` | none | Activation funnel |
| `first_account_created` | `method: 'manual' \| 'bank_connection'` | Activation funnel, no account data |
| `bank_connection_started` | none | Funnel step |
| `bank_connection_completed` | none | Funnel step — deliberately no institution name; propose adding it separately if there's a real product need, since it's a weaker identifier but still not zero-risk |
| `bank_connection_failed` | none | Funnel step, no error text (matches "no secrets in logs") |
| `feedback_submitted` | `category: 'bug' \| 'feature_request' \| 'other'` | Matches the gap `link-policy.ts` already documents; message text stays in the existing mailto channel, never PostHog |
| `feature_screen_viewed` | `screen: <enum of route names>` | Generic engagement signal, equivalent to web's `$pageview`; `screen` is a closed enum of route identifiers, never a raw path with IDs in it (e.g. `portfolio_detail`, not `/portfolio/abc123`) |

Explicitly **not** proposed in this first pass, pending a real product justification if wanted
later: anything under accounts/portfolios/transactions/budgets/goals/recurring/reports/markets
beyond the generic `feature_screen_viewed` above, and anything from Settings beyond what's listed.

## Consequences

- Mobile analytics will be sparser than web's for a while. That's the intended trade — a financial
  app expanding into stricter-privacy locales (this app ships PT-PT and ES) errs conservative
  first and widens deliberately, not the reverse.
- Product/growth questions that need account- or transaction-level signal are out of reach until
  someone proposes a specific, minimal property for a specific event and it goes through this same
  approval path — not solved by loosening the general rule.
- Web's existing PII-carrying events are unaffected by this document; it governs mobile only. If
  this is read as a reason to also tighten web's PostHog usage, that's a separate, explicit
  decision for whoever owns that repo, not something this ADR does by implication.

## Approval

- [x] Reviewed and approved as-is
- Approved by: the maintainer (chat-session record)  Date: 2026-08-12
- Edits made before approval: none
