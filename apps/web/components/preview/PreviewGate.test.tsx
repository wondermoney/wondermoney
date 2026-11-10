// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, test, vi } from "vitest";

const state = vi.hoisted(() => ({ enabled: false }));

vi.mock("@/lib/api/preview-features/usePreviewFeatures", () => ({
  usePreviewFeatures: () => state.enabled,
}));

import { PreviewGate } from "./PreviewGate";

afterEach(cleanup);

test("hides a preview entry point while the flag is off", () => {
  state.enabled = false;

  render(
    <PreviewGate>
      <span>Labs</span>
    </PreviewGate>,
  );

  assert.equal(screen.queryByText("Labs"), null);
});

test("shows the entry point once the flag is on", () => {
  state.enabled = true;

  render(
    <PreviewGate>
      <span>Labs</span>
    </PreviewGate>,
  );

  assert.ok(screen.getByText("Labs"));
});

test("renders the fallback in place of the entry point when one is given", () => {
  state.enabled = false;

  render(
    <PreviewGate fallback={<span>Not available yet</span>}>
      <span>Labs</span>
    </PreviewGate>,
  );

  assert.ok(screen.getByText("Not available yet"));
  assert.equal(screen.queryByText("Labs"), null);
});
