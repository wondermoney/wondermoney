import assert from "node:assert/strict";

import { test } from "vitest";

import {
  formatGoalCurrency,
  formatGoalDate,
  formatGoalPercentage,
} from "./format";

test("formats goal currency with the active locale and two decimals", () => {
  // Given
  const amount = 1100;

  // When
  const english = formatGoalCurrency(amount, "EUR", "en");
  const portuguese = formatGoalCurrency(amount, "EUR", "pt");

  // Then
  assert.notEqual(english, portuguese);
  assert.match(english, /1,100\.00/);
  assert.equal(portuguese, "1100,00 €");
});

test("formats goal dates with the active locale", () => {
  // Given
  const date = "2027-12-31T12:00:00.000Z";

  // When
  const english = formatGoalDate(date, "en");
  const portuguese = formatGoalDate(date, "pt");

  // Then
  assert.notEqual(english, portuguese);
  assert.match(english, /Dec/);
  assert.equal(portuguese, "31/12/2027");
});

test("formats goal percentages with locale-aware percent signs", () => {
  // Given
  const percentage = 9;

  // When
  const english = formatGoalPercentage(percentage, "en");
  const spanish = formatGoalPercentage(percentage, "es");

  // Then
  assert.match(english, /9%/);
  assert.match(spanish, /9\s?%/);
});
