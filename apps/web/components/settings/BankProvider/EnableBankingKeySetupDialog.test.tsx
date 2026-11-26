// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, beforeEach, test, vi } from "vitest";

import enCommon from "../../../messages/en/common.json";
import EnableBankingKeySetupDialog from "./EnableBankingKeySetupDialog";

type Mutate = (
  input: unknown,
  handlers: {
    onError?: (error: unknown) => void;
    onSuccess?: (data: unknown) => void;
  },
) => void;

const APPLICATION_ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
const PRIVATE_KEY =
  "-----BEGIN PRIVATE KEY-----\nMIIE\n-----END PRIVATE KEY-----";

const h = vi.hoisted(() => ({
  save: vi.fn<Mutate>(),
  session: { user: { id: "user-1", twoFactorEnabled: false } } as {
    session?: { createdAt: string };
    user: { id: string; twoFactorEnabled: boolean };
  },
  signOut: vi.fn(async () => {}),
}));

vi.mock("@/lib/api/user/useEnableBankingCredential", () => ({
  useSaveEnableBankingCredential: () => ({ isPending: false, mutate: h.save }),
}));
vi.mock("@/lib/api/useRateLimitToast", () => ({
  useRateLimitToast: () => () => false,
}));
vi.mock("@/lib/auth/client", () => ({
  authClient: { signOut: h.signOut, useSession: () => ({ data: h.session }) },
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  window.matchMedia ??= ((query: string) => ({
    addEventListener: () => {},
    addListener: () => {},
    dispatchEvent: () => false,
    matches: query.includes("min-width"),
    media: query,
    onchange: null,
    removeEventListener: () => {},
    removeListener: () => {},
  })) as typeof window.matchMedia;
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
});

beforeEach(() => {
  window.sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  h.save.mockReset();
  h.session = { user: { id: "user-1", twoFactorEnabled: false } };
  h.signOut.mockClear();
});

const apiError = (code: string, status = 403) => ({
  response: { data: { code, message: "English server text" }, status },
});

async function openForm() {
  const user = userEvent.setup();
  render(
    <NextIntlClientProvider locale="en" messages={enCommon} timeZone="UTC">
      <EnableBankingKeySetupDialog
        triggerLabel="I already have a key"
        isUpdate={false}
      />
    </NextIntlClientProvider>,
  );
  await user.click(
    screen.getByRole("button", { name: "I already have a key" }),
  );
  return user;
}

async function fillKey(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Application ID"), APPLICATION_ID);
  // A PEM has newlines, which `type` would read as Enter: paste it as one value.
  await user.click(screen.getByLabelText("Private key"));
  await user.paste(PRIVATE_KEY);
}

/** Stand in for the page the browser is on, to see where signing in again sends it. */
function onPage(path: string, search: string) {
  const assign = vi.fn();
  const originalLocation = window.location;
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { assign, origin: "http://localhost", pathname: path, search },
  });
  return {
    assign,
    restore: () =>
      Object.defineProperty(window, "location", {
        configurable: true,
        value: originalLocation,
      }),
  };
}

test("without two-factor, the key is saved without asking for a code", async () => {
  const user = await openForm();

  assert.equal(screen.queryByLabelText("Authenticator code"), null);
  await fillKey(user);
  await user.click(screen.getByRole("button", { name: "Test & Save" }));

  await waitFor(() => assert.equal(h.save.mock.calls.length, 1));
  assert.deepEqual(h.save.mock.calls[0]?.[0], {
    applicationId: APPLICATION_ID,
    privateKeyPem: PRIVATE_KEY,
  });
});

test("with two-factor on, it asks for the authenticator code and sends it with the key", async () => {
  h.session = { user: { id: "user-1", twoFactorEnabled: true } };
  const user = await openForm();

  await fillKey(user);
  await user.type(screen.getByLabelText("Authenticator code"), "123456");
  await user.click(screen.getByRole("button", { name: "Test & Save" }));

  await waitFor(() => assert.equal(h.save.mock.calls.length, 1));
  assert.deepEqual(h.save.mock.calls[0]?.[0], {
    applicationId: APPLICATION_ID,
    privateKeyPem: PRIVATE_KEY,
    totpCode: "123456",
  });
});

test("a code the server asks for gets its field, and a wrong one is cleared and explained", async () => {
  h.save.mockImplementationOnce((_input, { onError }) =>
    onError?.(apiError("totp_required")),
  );
  const user = await openForm();

  await fillKey(user);
  await user.click(screen.getByRole("button", { name: "Test & Save" }));
  assert.ok(
    await screen.findByText("Enter your authenticator code to continue."),
  );

  h.save.mockImplementationOnce((_input, { onError }) =>
    onError?.(apiError("invalid_totp")),
  );
  await user.type(screen.getByLabelText("Authenticator code"), "111111");
  await user.click(screen.getByRole("button", { name: "Test & Save" }));

  assert.ok(await screen.findByText("That authenticator code is not valid."));
  assert.equal(
    (screen.getByLabelText("Authenticator code") as HTMLInputElement).value,
    "",
  );
  assert.equal(
    (screen.getByLabelText("Application ID") as HTMLInputElement).value,
    APPLICATION_ID,
  );
  assert.equal(
    (h.save.mock.calls[1]?.[0] as { totpCode?: string }).totpCode,
    "111111",
  );
});

test("a session too old to save a key asks to sign in again before anything is typed, and comes back to the form", async () => {
  h.session = {
    session: {
      createdAt: new Date(Date.now() - 23.5 * 60 * 60 * 1000).toISOString(),
    },
    user: { id: "user-1", twoFactorEnabled: false },
  };
  const page = onPage("/en/settings", "?tab=bank-provider");
  try {
    const user = await openForm();

    assert.ok(screen.getByRole("heading", { name: "Sign in again first" }));
    assert.equal(screen.queryByLabelText("Private key"), null);
    await user.click(screen.getByRole("button", { name: "Sign in again" }));

    await waitFor(() => assert.equal(page.assign.mock.calls.length, 1));
    assert.equal(h.signOut.mock.calls.length, 1);
    const login = new URL(String(page.assign.mock.calls[0]?.[0]));
    assert.equal(login.pathname, "/en/auth/login");
    assert.equal(
      login.searchParams.get("next"),
      "/en/settings?tab=bank-provider",
    );
    assert.match(
      window.sessionStorage.getItem("wm:enable-banking-setup:reopen") ?? "",
      /"target":"paste"/,
    );
  } finally {
    page.restore();
  }
});

test("session_not_fresh from the server drops what was typed and offers to sign in again", async () => {
  h.save.mockImplementation((_input, { onError }) =>
    onError?.(apiError("session_not_fresh")),
  );
  const user = await openForm();

  await fillKey(user);
  await user.click(screen.getByRole("button", { name: "Test & Save" }));

  assert.ok(await screen.findByRole("button", { name: "Sign in again" }));
  assert.equal(screen.queryByLabelText("Private key"), null);
});

test("back from signing in again for it, the form opens itself, and a mark for the wizard is left alone", async () => {
  window.sessionStorage.setItem(
    "wm:enable-banking-setup:reopen",
    JSON.stringify({
      at: Date.now(),
      path: window.location.pathname,
      target: "wizard",
    }),
  );
  render(
    <NextIntlClientProvider locale="en" messages={enCommon} timeZone="UTC">
      <EnableBankingKeySetupDialog
        triggerLabel="I already have a key"
        isUpdate={false}
      />
    </NextIntlClientProvider>,
  );
  assert.equal(screen.queryByRole("dialog"), null);
  assert.notEqual(
    window.sessionStorage.getItem("wm:enable-banking-setup:reopen"),
    null,
  );
  cleanup();

  window.sessionStorage.setItem(
    "wm:enable-banking-setup:reopen",
    JSON.stringify({
      at: Date.now() - 5 * 60 * 1000,
      path: window.location.pathname,
      target: "paste",
    }),
  );
  render(
    <NextIntlClientProvider locale="en" messages={enCommon} timeZone="UTC">
      <EnableBankingKeySetupDialog
        triggerLabel="I already have a key"
        isUpdate={false}
      />
    </NextIntlClientProvider>,
  );
  await waitFor(() =>
    screen.getByRole("heading", { name: "Add your Enable Banking key" }),
  );
  assert.equal(
    window.sessionStorage.getItem("wm:enable-banking-setup:reopen"),
    null,
  );
});
