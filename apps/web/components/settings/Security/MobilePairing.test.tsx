// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, test, vi } from "vitest";

import type {
  MobileDevice,
  PairingCode,
} from "@/lib/api/user/useMobileDevices";

import enCommon from "../../../messages/en/common.json";
import MobilePairing, {
  formatCountdown,
  secondsRemaining,
} from "./MobilePairing";

const state = vi.hoisted(() => ({
  create: vi.fn(),
  devices: [] as unknown[],
  revoke: vi.fn(),
}));

vi.mock("@/lib/api/user/useMobileDevices", () => ({
  useMobileDevices: () => ({ data: state.devices, isLoading: false }),
  useCreatePairingCode: () => ({ isPending: false, mutateAsync: state.create }),
  useRevokeMobileDevice: () => ({ isPending: false, mutateAsync: state.revoke }),
}));

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
});

afterEach(() => {
  cleanup();
  state.create.mockReset();
  state.revoke.mockReset();
  state.devices = [];
});

function renderPanel(devices: MobileDevice[] = []) {
  state.devices = devices;
  render(
    <NextIntlClientProvider locale="en" messages={enCommon}>
      <MobilePairing />
    </NextIntlClientProvider>,
  );
}

const codeExpiringIn = (seconds: number): PairingCode => ({
  code: "code-abc",
  expiresAt: new Date(Date.now() + seconds * 1000).toISOString(),
  url: "wondermoney://pair?code=code-abc&server=https%3A%2F%2Fapi.example.test",
});

const phone: MobileDevice = {
  id: "session-1",
  label: "WonderMoney/1.0.2 (iOS 18.0)",
  lastSeenAt: "2026-01-02T10:30:00.000Z",
  pairedAt: "2026-01-01T09:00:00.000Z",
};

test("shows the QR code and counts the code down", async () => {
  state.create.mockResolvedValue(codeExpiringIn(90));
  renderPanel();

  await userEvent.click(screen.getByRole("button", { name: "Show QR code" }));

  const qr = await screen.findByRole("img", {
    name: "QR code that pairs the WonderMoney mobile app with this server",
  });
  assert.ok(qr.querySelector("svg"));
  await waitFor(() =>
    assert.match(screen.getByText(/Expires in \d:\d\d/u).textContent ?? "", /Expires in 1:2\d|Expires in 1:30/u),
  );
});

test("offers a new code once the current one has expired", async () => {
  state.create.mockResolvedValue(codeExpiringIn(-1));
  renderPanel();

  await userEvent.click(screen.getByRole("button", { name: "Show QR code" }));

  assert.ok(await screen.findByText("This code has expired. Show a new one."));
  assert.ok(screen.getByRole("button", { name: "New QR code" }));
});

test("sends the authenticator code when one is typed", async () => {
  state.create.mockResolvedValue(codeExpiringIn(90));
  renderPanel();

  await userEvent.type(screen.getByLabelText("Authenticator code"), "123456");
  await userEvent.click(screen.getByRole("button", { name: "Show QR code" }));

  await waitFor(() => assert.equal(state.create.mock.calls[0]?.[0], "123456"));
});

test("lists paired devices and revokes the one chosen", async () => {
  state.revoke.mockResolvedValue(undefined);
  renderPanel([phone]);

  assert.ok(screen.getByText("WonderMoney/1.0.2 (iOS 18.0)"));
  assert.ok(screen.getByText(/Last seen/u));

  await userEvent.click(screen.getByRole("button", { name: "Revoke" }));
  await userEvent.click(await screen.findByRole("button", { name: "Revoke device" }));

  await waitFor(() => assert.deepEqual(state.revoke.mock.calls[0], ["session-1"]));
});

test("says so when no phone is connected", () => {
  renderPanel();
  assert.ok(screen.getByText("No phones are connected yet."));
});

test("counts down in whole seconds and never below zero", () => {
  const expiresAt = "2026-01-01T00:02:00.000Z";
  const start = new Date("2026-01-01T00:00:00.000Z").getTime();

  assert.equal(secondsRemaining(expiresAt, start), 120);
  assert.equal(secondsRemaining(expiresAt, start + 60_000), 60);
  assert.equal(secondsRemaining(expiresAt, start + 120_000), 0);
  assert.equal(secondsRemaining(expiresAt, start + 500_000), 0);
  assert.equal(formatCountdown(90), "1:30");
  assert.equal(formatCountdown(9), "0:09");
});
