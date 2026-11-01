import { describe, expect, it } from "vitest";

import { FIRST_RUN_EVENTS } from "./types";

/**
 * The names are asserted literally because they are the join key to a year of
 * PostHog history: renaming one silently detaches every past event, and nothing
 * would fail loudly. That the steps actually emit them is tested by driving the
 * steps in `components/onboarding/first-run/connect-funnel.test.tsx`.
 */
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
