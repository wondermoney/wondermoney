import assert from "node:assert/strict";

import { test } from "vitest";

import { goalsForView } from "./view";

const goals = [
  { goalKey: 1, status: "active" },
  { goalKey: 2, status: "paused" },
  { goalKey: 3, status: "completed" },
  { goalKey: 4, status: "archived" },
] as const;

test("the active view is every goal not archived", () => {
  assert.deepEqual(
    goalsForView([...goals], "active").map((goal) => goal.goalKey),
    [1, 2, 3],
  );
});

test("the archived view is the archived goals only", () => {
  assert.deepEqual(
    goalsForView([...goals], "archived").map((goal) => goal.goalKey),
    [4],
  );
});
