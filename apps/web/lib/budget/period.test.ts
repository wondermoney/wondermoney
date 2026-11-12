import assert from "node:assert/strict";

import { test } from "vitest";

import { budgetPeriodLabel as label } from "./period";

// Intl puts thin and narrow spaces around the dash; compare the words.
const budgetPeriodLabel = (...args: Parameters<typeof label>) =>
  label(...args)?.replace(/\s/gu, " ") ?? null;

test("a budget month that starts on the 25th is labelled with its days", () => {
  assert.equal(
    budgetPeriodLabel(
      { firstDay: "2026-10-25", lastDay: "2026-11-24" },
      25,
      "en",
    ),
    "Oct 25 – Nov 24",
  );
  assert.equal(
    budgetPeriodLabel(
      { firstDay: "2026-10-25", lastDay: "2026-11-24" },
      25,
      "pt",
    ),
    "25 de out. – 24 de nov.",
  );
});

test("a budget month across the new year names both years", () => {
  assert.equal(
    budgetPeriodLabel(
      { firstDay: "2026-12-25", lastDay: "2027-01-24" },
      25,
      "es",
    ),
    "25 dic 2026 – 24 ene 2027",
  );
});

test("a calendar month needs no label: start day 1 or no start day", () => {
  const november = { firstDay: "2026-11-01", lastDay: "2026-11-30" };
  assert.equal(budgetPeriodLabel(november, 1, "en"), null);
  assert.equal(budgetPeriodLabel(november, undefined, "en"), null);
  assert.equal(budgetPeriodLabel(undefined, 25, "en"), null);
});

test("the days are read as calendar days, whatever the viewer's zone", () => {
  const previous = process.env.TZ;
  process.env.TZ = "America/Los_Angeles";
  try {
    assert.equal(
      budgetPeriodLabel(
        { firstDay: "2026-01-28", lastDay: "2026-02-27" },
        28,
        "en",
      ),
      "Jan 28 – Feb 27",
    );
  } finally {
    process.env.TZ = previous;
  }
});
