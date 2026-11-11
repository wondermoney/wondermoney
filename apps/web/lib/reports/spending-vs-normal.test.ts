import assert from "node:assert/strict";

import { describe, expect, it } from "vitest";

import {
  spendingVsNormalChange,
  spendingVsNormalFill,
  spendingVsNormalTextClass,
  spendingVsNormalTone,
} from "./spending-vs-normal";

describe("spendingVsNormalTone", () => {
  it("is neutral without a baseline", () => {
    assert.equal(spendingVsNormalTone(null), "none");
  });

  it("reads the bands as a ratio to normal", () => {
    expect([
      spendingVsNormalTone(0.5),
      spendingVsNormalTone(0.85),
      spendingVsNormalTone(0.86),
      spendingVsNormalTone(1),
      spendingVsNormalTone(1.15),
      spendingVsNormalTone(1.16),
      spendingVsNormalTone(1.5),
      spendingVsNormalTone(1.51),
    ]).toEqual(["below", "below", "near", "near", "near", "above", "above", "wellAbove"]);
  });

  it("never colours a no-baseline tile as above normal", () => {
    assert.equal(spendingVsNormalTone(null), "none");
    assert.equal(spendingVsNormalFill("none"), "var(--muted)");
  });

  it("pairs every fill with its own foreground", () => {
    assert.equal(spendingVsNormalFill("below"), "var(--success)");
    assert.equal(spendingVsNormalTextClass("below"), "text-success-foreground");
    assert.equal(spendingVsNormalFill("above"), "var(--warning)");
    assert.equal(spendingVsNormalTextClass("above"), "text-warning-foreground");
    assert.equal(spendingVsNormalFill("wellAbove"), "var(--destructive)");
    assert.equal(spendingVsNormalTextClass("wellAbove"), "text-destructive-foreground");
  });
});

describe("spendingVsNormalChange", () => {
  it("is the percentage away from normal", () => {
    assert.equal(spendingVsNormalChange({ categoryKey: "1", name: "Food", normal: 100, parentKey: null, ratio: 1.5, total: 150 }), 50);
    assert.equal(
      Math.round(
        spendingVsNormalChange({ categoryKey: "1", name: "Food", normal: 100, parentKey: null, ratio: 0.8, total: 80 }) ?? 0,
      ),
      -20,
    );
  });

  it("is absent without a baseline", () => {
    assert.equal(spendingVsNormalChange({ categoryKey: "1", name: "Food", normal: null, parentKey: null, ratio: null, total: 80 }), null);
  });
});
