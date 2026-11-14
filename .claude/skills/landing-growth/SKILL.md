---
name: landing-growth
description: The growth loop for the WonderMoney marketing site (apps/landing) - measure, pick one hypothesis, change the page in all six locales, and record what to measure afterwards. Use for landing page copy, conversion, SEO or positioning work, and when asked how to grow sign-ups or traffic.
---

# Landing page growth

Each change to the landing page is a **bet**: one hypothesis, one metric, one date to read the
result. The loop keeps bets small enough to tell which one worked.

## Steps

1. **Context.** Read `.agents/product-marketing.md` (audience, promise, differentiators, voice),
   `apps/landing/AGENTS.md` and `apps/landing/DESIGN.md`. A positioning question the file does
   not answer is settled with the person and written into that file before any copy changes.

2. **Measure.** The site sends pageviews and events to PostHog after consent
   (`apps/landing/src/lib/posthog.ts`). Through the PostHog tools when they are connected,
   otherwise from numbers the person provides, get for the last 28 days, by locale and by page:
   visitors, the share who click through to sign up, and where they came from. Add search
   impressions and positions when Search Console data is available. State plainly what you
   could not get; a bet made without data is labelled a **heuristic bet**.

3. **Find the leak.** Name the single biggest drop: the page with traffic and few clicks, the
   locale that converts far below the others, the query that ranks and earns no visit. Look at
   past bets so the same one is not placed twice:
   `gh pr list --state merged --search 'Hypothesis in:body landing' --limit 20`.

4. **Place one bet**, as a sentence: "Because <evidence>, changing <element> on <page> will
   raise <metric> from <baseline>." Offer the person two or three candidate bets as a
   multiple-choice question, your recommendation first.

5. **Make the change.**
   - Copy in all six locales (`pt`, `en`, `es`, `fr`, `de`, `it`); `pt` is the default, is
     European Portuguese and says "tu". Write each locale for its readers; a translated idiom
     is a rewrite.
   - Every claim is one the product keeps: `src/lib/claimsAlignment.test.ts` and
     `scripts/check-offer-alignment.mjs` guard claims and the offer. The offer is free and
     open source, hosted or self-hosted.
   - Canonical URLs, hreflang alternates, structured data and localized slugs move together.
   - Layout and visual changes follow `apps/landing/DESIGN.md`.
   - The copywriting, conversion, SEO and schema skills of the marketing skills pack, when
     installed, do the specialist work; they read the same positioning file.

6. **Verify.** `pnpm verify:changed`, then look at the changed page in a browser at desktop and
   phone width, in at least `pt` and `en`.

7. **Record the bet** in the pull request, under these headings, so the next run can find it:
   **Hypothesis**, **Metric and baseline**, **Read on** (a date at least 14 days after
   release), **What we will do with the result**.

8. **Read old bets.** When a past bet's date has passed, measure it, comment the result on its
   pull request, and keep, extend or revert the change.

## Done

One bet is live or in a pull request with its four headings filled, every locale carries the
change, and the claims guards pass.
