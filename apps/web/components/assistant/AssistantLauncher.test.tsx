// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, test, vi } from "vitest";

import enMessages from "../../messages/en/common.json";
import AssistantLauncher from "./AssistantLauncher";

const state = vi.hoisted(() => ({ aiHidden: false, launcherHidden: false }));

vi.mock("@/lib/api/assistant/useAssistantConsent", () => ({
  default: () => ({ data: { launcherHidden: state.launcherHidden } }),
}));
vi.mock("@/lib/api/user-preferences/useAiHidden", () => ({
  default: () => state.aiHidden,
}));

afterEach(() => {
  cleanup();
  state.aiHidden = false;
  state.launcherHidden = false;
});

function renderLauncher() {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <AssistantLauncher />
    </NextIntlClientProvider>,
  );
}

test("shows the launcher when AI is available and not dismissed", () => {
  renderLauncher();

  assert.ok(screen.getByTestId("assistant-launcher"));
});

test("hides the launcher and the panel when the person hid AI", () => {
  state.aiHidden = true;

  renderLauncher();

  assert.equal(screen.queryByTestId("assistant-launcher"), null);
});

test("still honours the person's own choice to hide the launcher", () => {
  state.launcherHidden = true;

  renderLauncher();

  assert.equal(screen.queryByTestId("assistant-launcher"), null);
});
