// @vitest-environment jsdom
import assert from "node:assert/strict";

import type { UseQueryResult } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, test } from "vitest";

import type {
  GetGoalActivityResponse,
  GoalActivity,
} from "@/lib/api/goals/types";

import enMessages from "../../../../../messages/en/common.json";
import GoalActivityList from "./GoalActivityList";

afterEach(cleanup);

const warning = enMessages.goals["goal-activity-transaction-expired"];

const spent = (
  goalActivityKey: number,
  transactionExpired?: boolean,
): GoalActivity => ({
  amount: 20,
  goalActivityKey,
  goalKey: 1,
  occurredAt: "2026-10-01T10:00:00.000Z",
  transactionExpired,
  transactionKey: 100 + goalActivityKey,
  type: "spent_from_goal",
});

function renderActivities(activities: GoalActivity[]) {
  const activityQuery = {
    data: { activities, limit: 25, offset: 0, total: activities.length },
    isError: false,
    isLoading: false,
  } as UseQueryResult<GetGoalActivityResponse, Error>;
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <GoalActivityList activityQuery={activityQuery} currencyCode="EUR" />
    </NextIntlClientProvider>,
  );
}

test("warns, in words, on a funding whose transaction the bank has since dropped", () => {
  renderActivities([spent(1, true)]);
  const item = screen.getByText(warning).closest("li");
  assert.ok(item, "the warning sits inside the activity entry it is about");
  assert.match(
    item.textContent ?? "",
    new RegExp(enMessages.goals["goal-activity-spent_from_goal"]),
  );
});

test("does not warn on fundings whose transaction still stands, or from a server without the flag", () => {
  renderActivities([spent(1, false), spent(2)]);
  assert.equal(screen.queryByText(warning), null);
  assert.equal(screen.getAllByRole("listitem").length, 2);
});
