// @vitest-environment jsdom
import assert from "node:assert/strict";

import { QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, beforeEach, test, vi } from "vitest";

import {
  instanceFeatures,
  queryClientWithInstance,
} from "@/lib/api/instance/instance-fixture";
import { isPasskeyOfferPending } from "@/lib/auth/passkey-offer";

import enMessages from "../../messages/en/common.json";
import LoginForm from "./LoginForm";

const APP_ORIGIN = "http://localhost:3000";

const { apiPost, authClient, toastError } = vi.hoisted(() => ({
  apiPost: vi.fn(),
  authClient: {
    signIn: { email: vi.fn(), passkey: vi.fn(), social: vi.fn() },
    signOut: vi.fn(),
  },
  toastError: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ locale: "en" }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("@/lib/auth/client", () => ({ authClient }));
vi.mock("@/lib/api/api", () => ({ default: { post: apiPost } }));
vi.mock("sonner", () => ({ toast: { error: toastError, success: vi.fn() } }));

const originalLocation = window.location;
const assign = vi.fn();

/** A browser with WebAuthn; `autofill` says whether it offers passkeys in form suggestions. */
function browserWithPasskeys({ autofill }: { autofill: boolean }) {
  Object.defineProperty(window, "isSecureContext", {
    configurable: true,
    value: true,
  });
  Object.defineProperty(window, "PublicKeyCredential", {
    configurable: true,
    value: Object.assign(function PublicKeyCredential() {}, {
      isConditionalMediationAvailable: () => Promise.resolve(autofill),
    }),
  });
}

beforeEach(() => {
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...originalLocation, assign, origin: APP_ORIGIN, search: "" },
  });
  apiPost.mockResolvedValue({ data: { method: "email", outcome: "login" } });
  window.sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: originalLocation,
  });
  Reflect.deleteProperty(window, "PublicKeyCredential");
});

function renderLogin(
  features = instanceFeatures(),
  nextParam: null | string = null,
) {
  render(
    <QueryClientProvider client={queryClientWithInstance(features)}>
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <LoginForm nextParam={nextParam} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

const passkeyButton = () =>
  screen.queryByRole("button", { name: enMessages["passkeys-sign-in"] });

test("signs in with a passkey and goes straight to the app, with no MFA step", async () => {
  browserWithPasskeys({ autofill: false });
  authClient.signIn.passkey.mockResolvedValue({
    data: { session: {}, user: {} },
    error: null,
  });
  renderLogin(instanceFeatures(), "/en/budgets");

  fireEvent.click(passkeyButton()!);

  await waitFor(() => assert.equal(assign.mock.calls.length, 1));
  assert.deepEqual(authClient.signIn.passkey.mock.calls[0]![0], {
    autoFill: false,
  });
  // Provisioned like any other sign-in, then on to `next`, not to /auth/mfa.
  assert.equal(apiPost.mock.calls[0]![0], "/v1/auth/callback");
  assert.equal(
    new URL(String(assign.mock.calls[0]![0])).pathname,
    "/en/budgets",
  );
  // A passkey sign-in is not followed by the offer to add a passkey.
  assert.equal(isPasskeyOfferPending(), false);
});

test("a closed passkey prompt is not an error", async () => {
  browserWithPasskeys({ autofill: false });
  authClient.signIn.passkey.mockResolvedValue({
    data: null,
    error: {
      code: "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY",
      message: "The operation either timed out or was not allowed.",
      status: 400,
    },
  });
  renderLogin();

  fireEvent.click(passkeyButton()!);

  await waitFor(() =>
    assert.equal(authClient.signIn.passkey.mock.calls.length, 1),
  );
  assert.equal(toastError.mock.calls.length, 0);
  assert.equal(assign.mock.calls.length, 0);
});

test("a passkey the server rejects says so and stays on the login page", async () => {
  browserWithPasskeys({ autofill: false });
  authClient.signIn.passkey.mockResolvedValue({
    data: null,
    error: {
      code: "PASSKEY_NOT_FOUND",
      message: "Passkey not found",
      status: 401,
    },
  });
  renderLogin();

  fireEvent.click(passkeyButton()!);

  await waitFor(() => assert.equal(toastError.mock.calls.length, 1));
  assert.equal(
    toastError.mock.calls[0]![0],
    enMessages["passkeys-sign-in-error"],
  );
  assert.equal(assign.mock.calls.length, 0);
});

test("offers saved passkeys from the email field when the browser supports autofill", async () => {
  browserWithPasskeys({ autofill: true });
  authClient.signIn.passkey.mockResolvedValue({
    data: { session: {}, user: {} },
    error: null,
  });
  renderLogin();

  const email = screen.getByLabelText(enMessages.email);
  assert.match(email.getAttribute("autocomplete") ?? "", /\bwebauthn\b/);
  // Picking a passkey from the suggestions resolves the waiting request and signs in.
  await waitFor(() => assert.equal(assign.mock.calls.length, 1));
  assert.deepEqual(authClient.signIn.passkey.mock.calls[0]![0], {
    autoFill: true,
  });
});

test("hides passkey sign-in on a server without passkeys", () => {
  browserWithPasskeys({ autofill: true });
  renderLogin(instanceFeatures({ passkey: false }));

  assert.equal(passkeyButton(), null);
  assert.equal(authClient.signIn.passkey.mock.calls.length, 0);
});

test("hides passkey sign-in in a browser without WebAuthn", () => {
  renderLogin();

  assert.equal(passkeyButton(), null);
});

test("a password sign-in leaves the offer to add a passkey for the next page, MFA or not", async () => {
  for (const data of [{ user: {} }, { twoFactorRedirect: true }]) {
    window.sessionStorage.clear();
    assign.mockClear();
    authClient.signIn.email.mockResolvedValue({ data, error: null });
    renderLogin();
    fireEvent.change(screen.getByLabelText(enMessages.email), {
      target: { value: "a@example.com" },
    });
    fireEvent.change(screen.getByLabelText(enMessages.password), {
      target: { value: "password123" },
    });
    fireEvent.click(screen.getByRole("button", { name: enMessages["log-in"] }));
    await waitFor(() => assert.equal(assign.mock.calls.length, 1));
    assert.equal(isPasskeyOfferPending(), true);
    cleanup();
  }
});

test("a wrong password leaves no offer", async () => {
  authClient.signIn.email.mockResolvedValue({
    data: null,
    error: { status: 401 },
  });
  renderLogin();
  fireEvent.change(screen.getByLabelText(enMessages.email), {
    target: { value: "a@example.com" },
  });
  fireEvent.change(screen.getByLabelText(enMessages.password), {
    target: { value: "password123" },
  });
  fireEvent.click(screen.getByRole("button", { name: enMessages["log-in"] }));

  await waitFor(() => assert.equal(toastError.mock.calls.length, 1));
  assert.equal(isPasskeyOfferPending(), false);
});
