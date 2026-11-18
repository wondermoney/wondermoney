import { describe, expect, it } from "vitest";
import { scoreInvestorProfile } from "./investorProfile";

describe("scoreInvestorProfile", () => {
  it.each([
    { answers: [0, 0, 0, 0, 0, 0], capacity: 0, comfort: 0, band: "lower" },
    { answers: [0, 1, 1, 2, 2, 2], capacity: 2, comfort: 6, band: "lower" },
    { answers: [2, 2, 2, 0, 1, 1], capacity: 6, comfort: 2, band: "lower" },
    { answers: [1, 1, 1, 2, 2, 2], capacity: 3, comfort: 6, band: "middle" },
    { answers: [2, 2, 2, 1, 1, 2], capacity: 6, comfort: 4, band: "middle" },
    { answers: [1, 2, 2, 2, 2, 2], capacity: 5, comfort: 6, band: "higher" },
    { answers: [2, 2, 2, 2, 2, 2], capacity: 6, comfort: 6, band: "higher" },
  ])("returns $band when capacity is $capacity and comfort is $comfort", ({ answers, ...result }) => {
    expect(scoreInvestorProfile(answers)).toEqual(result);
  });

  it.each([
    { label: "empty answers", answers: [] },
    { label: "too few answers", answers: [0, 1, 2, 0, 1] },
    { label: "too many answers", answers: [0, 1, 2, 0, 1, 2, 0] },
    { label: "sparse answers", answers: new Array(6) },
    { label: "negative answer", answers: [-1, 1, 2, 0, 1, 2] },
    { label: "very large answer", answers: [1e100, 1, 2, 0, 1, 2] },
    { label: "fractional answer", answers: [1.5, 1, 2, 0, 1, 2] },
    { label: "string answer", answers: ["0", 1, 2, 0, 1, 2] },
  ])("rejects $label", ({ answers }) => {
    expect(scoreInvestorProfile(answers)).toBeNull();
  });
});
