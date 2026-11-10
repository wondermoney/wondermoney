// @vitest-environment jsdom
import assert from "node:assert/strict";

import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, test } from "vitest";

import { useFormatCurrency } from "@/lib/utils/useFormatCurrency";

import { readPrivacyMode } from "./privacy-mode-store";
import { setStoredPrivacyMode, WithPrivacyMode } from "./privacy-test-utils";
import { usePrivacyMode, usePrivacyModeShortcut } from "./usePrivacyMode";

afterEach(() => {
  cleanup();
  setStoredPrivacyMode(false);
});

const wrapper = ({ children }: { children: ReactNode }) => (
  <NextIntlClientProvider locale="en" messages={{}}>
    {children}
  </NextIntlClientProvider>
);

test("privacy mode is off until someone turns it on", () => {
  const { result } = renderHook(() => usePrivacyMode(), { wrapper });
  assert.equal(result.current.hidden, false);
});

test("toggling persists on this device and updates every reader", () => {
  const { result } = renderHook(() => usePrivacyMode(), { wrapper });

  act(() => result.current.toggle());
  assert.equal(result.current.hidden, true);
  assert.equal(readPrivacyMode(), true, "stored for the next reload");

  act(() => result.current.setHidden(false));
  assert.equal(result.current.hidden, false);
  assert.equal(readPrivacyMode(), false);
});

test("a reload restores the stored choice", () => {
  setStoredPrivacyMode(true);
  const { result } = renderHook(() => usePrivacyMode(), {
    wrapper: ({ children }) => (
      <WithPrivacyMode hidden>{wrapper({ children })}</WithPrivacyMode>
    ),
  });
  assert.equal(result.current.hidden, true);
});

test("useFormatCurrency masks while privacy mode is on", () => {
  setStoredPrivacyMode(true);
  const { result } = renderHook(() => useFormatCurrency(), { wrapper });
  const text = result.current(185000, "EUR");
  assert.ok(!/\d/.test(text), text);
  assert.ok(text.includes("€"), text);
});

function ShortcutHarness() {
  usePrivacyModeShortcut();
  const { hidden } = usePrivacyMode();
  return (
    <div>
      <output>{hidden ? "hidden" : "shown"}</output>
      <input aria-label="note" />
    </div>
  );
}

test("Shift+P toggles, but not while typing in a field", () => {
  const { getByRole, container } = render(<ShortcutHarness />, { wrapper });
  const status = () => container.querySelector("output")?.textContent;

  fireEvent.keyDown(window, { code: "KeyP", key: "P", shiftKey: true });
  assert.equal(status(), "hidden");

  fireEvent.keyDown(getByRole("textbox"), {
    code: "KeyP",
    key: "P",
    shiftKey: true,
  });
  assert.equal(status(), "hidden", "a capital P in a field is just a letter");

  fireEvent.keyDown(window, { code: "KeyP", key: "P", metaKey: true, shiftKey: true });
  assert.equal(status(), "hidden", "a browser shortcut is left alone");

  fireEvent.keyDown(window, { code: "KeyP", key: "P", shiftKey: true });
  assert.equal(status(), "shown");
});
