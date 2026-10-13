import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { FIRST_RUN_EVENTS } from "./types";

/**
 * RAD-600. The first-run connect funnel went dark for a month without anything
 * failing: the events existed, but only on the Accounts-page flow, and first-run
 * never emitted them. Nothing broke, no test went red, and the one funnel that
 * matters most to the business — activation — simply stopped having a middle.
 *
 * So the guard is deliberately about *emission*, not shape. A test that only
 * checked the catalogue would have passed happily throughout the outage. These
 * read the component sources and assert each step of the chain is actually
 * captured somewhere.
 *
 * The names are asserted literally because they are the join key to a year of
 * PostHog history: renaming one silently detaches every past event, and nothing
 * would fail loudly.
 */

const read = (relativePath: string) => readFileSync(join(process.cwd(), relativePath), "utf8");

const ACCOUNT_STEP = "components/onboarding/first-run/FirstRunAccountStep.tsx";
const SYNC_STEP = "components/onboarding/first-run/FirstRunSyncStep.tsx";

describe("first-run connect funnel event names", () => {
  it("pins the wire names", () => {
    expect(FIRST_RUN_EVENTS.accountConnectClicked).toBe("first_run_account_connect_clicked");
    expect(FIRST_RUN_EVENTS.accountRequisitionCreated).toBe("first_run_account_requisition_created");
    expect(FIRST_RUN_EVENTS.accountRequisitionFailed).toBe("first_run_account_requisition_failed");
    expect(FIRST_RUN_EVENTS.accountBeforeRedirect).toBe("first_run_account_before_redirect");
    expect(FIRST_RUN_EVENTS.accountConnectReturned).toBe("first_run_account_connect_returned");
  });

  it("keeps every event name distinct, so no two steps collapse into one bucket", () => {
    const names = Object.values(FIRST_RUN_EVENTS);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("first-run connect funnel is actually emitted", () => {
  it("covers the outbound path: bank picked -> requisition -> redirect", () => {
    const source = read(ACCOUNT_STEP);
    for (const key of [
      "accountConnectClicked",
      "accountRequisitionCreated",
      "accountRequisitionFailed",
      "accountBeforeRedirect",
    ] as const) {
      expect(source, `${key} is defined but never captured`).toContain(`FIRST_RUN_EVENTS.${key}`);
    }
  });

  it("records the failure branch, which has a retry button and used to emit nothing", () => {
    // A user could sit on the handoff screen retrying a failing requisition
    // indefinitely and produce no telemetry at all.
    expect(read(ACCOUNT_STEP)).toContain("FIRST_RUN_EVENTS.accountRequisitionFailed");
  });

  it("records the return from the bank on every branch, not just the happy one", () => {
    const source = read(SYNC_STEP);
    expect(source).toContain("FIRST_RUN_EVENTS.accountConnectReturned");
    // Captured before the early return, or the error branches would be silent —
    // that early return is precisely how the outcome went unrecorded before.
    const capture = source.indexOf("FIRST_RUN_EVENTS.accountConnectReturned");
    const earlyReturn = source.indexOf('if (result.kind === "error_not_linked")');
    expect(capture).toBeGreaterThan(-1);
    expect(earlyReturn).toBeGreaterThan(-1);
    expect(capture).toBeLessThan(earlyReturn);
  });

  it("closes the funnel with the activation terminal event on the first-run path", () => {
    // first_account_added was emitted only from the Accounts-page flow, so the
    // funnel had no end once first-run became the dominant route.
    expect(read(SYNC_STEP)).toContain("ACTIVATION_EVENTS.firstAccountAdded");
  });
});
