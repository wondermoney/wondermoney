// @vitest-environment jsdom
import assert from "node:assert/strict";

import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, beforeEach, test, vi } from "vitest";

import {
  instanceFeatures,
  queryClientWithInstance,
} from "@/lib/api/instance/instance-fixture";
import {
  isPasskeyOfferPending,
  markPasskeyOfferPending,
} from "@/lib/auth/passkey-offer";

import enCommon from "../../messages/en/common.json";
import PasskeyOffer from "./PasskeyOffer";

const { authClient, toast } = vi.hoisted(() => ({
  authClient: { passkey: { addPasskey: vi.fn(), listUserPasskeys: vi.fn() } },
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("@/lib/auth/client", () => ({ authClient }));
vi.mock("@/lib/auth/user-context", () => ({
  useUser: () => ({ email: "ana@example.com", id: "user-1" }),
}));
vi.mock("sonner", () => ({ toast }));

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  window.matchMedia ??= (query: string) =>
    ({
      addEventListener() {},
      matches: true,
      media: query,
      removeEventListener() {},
    }) as unknown as MediaQueryList;
});

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  Object.defineProperty(window, "isSecureContext", {
    configurable: true,
    value: true,
  });
  Object.defineProperty(window, "PublicKeyCredential", {
    configurable: true,
    value: function PublicKeyCredential() {},
  });
  authClient.passkey.listUserPasskeys.mockResolvedValue({
    data: [],
    error: null,
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  Reflect.deleteProperty(window, "PublicKeyCredential");
});

function renderOffer(features = instanceFeatures()) {
  render(
    <QueryClientProvider client={queryClientWithInstance(features)}>
      <NextIntlClientProvider locale="en" messages={enCommon}>
        <PasskeyOffer />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

const offer = () =>
  screen.queryByRole("dialog", { name: enCommon["passkeys-offer-title"] });

test("after a password sign-in, offers to add a passkey to an account without one", async () => {
  markPasskeyOfferPending();
  renderOffer();

  await waitFor(() => assert.ok(offer()));
});

test('"Not now" closes the offer, and this browser does not offer it again', async () => {
  markPasskeyOfferPending();
  renderOffer();
  await waitFor(() => assert.ok(offer()));

  await userEvent.click(
    screen.getByRole("button", { name: enCommon["passkeys-offer-dismiss"] }),
  );

  await waitFor(() => assert.equal(offer(), null));
  cleanup();

  // The next password sign-in, same browser.
  markPasskeyOfferPending();
  renderOffer();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(offer(), null);
  assert.equal(authClient.passkey.listUserPasskeys.mock.calls.length, 1);
});

test("adding a passkey from the offer ends it", async () => {
  markPasskeyOfferPending();
  authClient.passkey.addPasskey.mockResolvedValue({
    data: { id: "pk-1" },
    error: null,
  });
  renderOffer();
  await waitFor(() => assert.ok(offer()));

  await userEvent.click(
    screen.getByRole("button", { name: enCommon["passkeys-offer-add"] }),
  );

  await waitFor(() => assert.equal(offer(), null));
  assert.equal(authClient.passkey.addPasskey.mock.calls.length, 1);
  assert.equal(isPasskeyOfferPending(), false);
});

test("an account that already has a passkey is not asked", async () => {
  markPasskeyOfferPending();
  authClient.passkey.listUserPasskeys.mockResolvedValue({
    data: [{ createdAt: "2026-01-01", id: "pk-1" }],
    error: null,
  });
  renderOffer();

  await waitFor(() => assert.equal(isPasskeyOfferPending(), false));
  assert.equal(offer(), null);
});

test("no offer without a password sign-in just before", async () => {
  renderOffer();

  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(offer(), null);
  assert.equal(authClient.passkey.listUserPasskeys.mock.calls.length, 0);
});

test("no offer on a server or in a browser without passkeys", async () => {
  markPasskeyOfferPending();
  renderOffer(instanceFeatures({ passkey: false }));
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(offer(), null);
  cleanup();

  Reflect.deleteProperty(window, "PublicKeyCredential");
  markPasskeyOfferPending();
  renderOffer();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(offer(), null);
  assert.equal(authClient.passkey.listUserPasskeys.mock.calls.length, 0);
});
