// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { useState } from "react";
import { afterEach, beforeAll, beforeEach, test, vi } from "vitest";

import type { EnableBankingCredentialResponse } from "@/lib/api/user/useEnableBankingCredential";

import enCommon from "../../../messages/en/common.json";
import EnableBankingSetupWizard, {
  ENABLE_BANKING_SIGN_IN_URL,
} from "./EnableBankingSetupWizard";

type Mutate = (
  input: unknown,
  handlers: { onError?: (error: unknown) => void; onSuccess?: (data: unknown) => void },
) => void;

const SETUP = {
  applicationDescription: "Personal use: reads my own bank accounts into WonderMoney.",
  applicationName: "WonderMoney",
  privacyUrl: "https://docs.example.test/privacy",
  redirectUrl: "https://api.example.test/v1/banking/enable-banking/callback",
  termsUrl: "https://docs.example.test/terms",
};
const APPLICATION_ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
const CERTIFICATE = {
  certificatePem: "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n",
  expiresAt: "2026-12-03T00:00:00.000Z",
};
const PENDING: EnableBankingCredentialResponse = {
  applicationId: null,
  lastValidatedAt: null,
  lastValidationError: null,
  pending: { expiresAt: "2026-12-03T00:00:00.000Z" },
  status: "pending",
};

const h = vi.hoisted(() => ({
  activate: vi.fn<Mutate>(),
  track: vi.fn<(event: string, properties?: Record<string, unknown>) => void>(),
  create: vi.fn<Mutate>(),
  credential: null as EnableBankingCredentialResponse,
  session: { user: { id: "user-1", twoFactorEnabled: false } } as {
    session?: { createdAt: string };
    user: { id: string; twoFactorEnabled: boolean };
  },
  signOut: vi.fn(async () => {}),
  pasteDialog: null as null | { isUpdate?: boolean; open?: boolean; onSaved?: () => void },
}));

vi.mock("@/lib/api/user/useEnableBankingCredential", () => ({
  default: () => ({ data: h.credential, isError: false, isSuccess: true }),
  useActivateEnableBankingCredential: () => ({ isPending: false, mutate: h.activate }),
  useCreateEnableBankingCertificate: () => ({ isPending: false, mutate: h.create }),
}));
vi.mock("@/lib/analytics/track", () => ({ track: h.track }));
vi.mock("@/lib/api/instance/useInstance", () => ({ useEnableBankingSetup: () => SETUP }));
vi.mock("@/lib/api/useRateLimitToast", () => ({ useRateLimitToast: () => () => false }));
vi.mock("@/lib/auth/client", () => ({ authClient: { signOut: h.signOut, useSession: () => ({ data: h.session }) } }));
vi.mock("./EnableBankingKeySetupDialog", () => ({
  default: (props: { isUpdate?: boolean; open?: boolean; onSaved?: () => void }) => {
    h.pasteDialog = props;
    return props.open ? <div data-testid="paste-key-form" /> : null;
  },
}));

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
  window.localStorage.clear();
  window.sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  h.activate.mockReset();
  h.create.mockReset();
  h.credential = null;
  h.session = { user: { id: "user-1", twoFactorEnabled: false } };
  h.signOut.mockClear();
  h.track.mockReset();
  h.pasteDialog = null;
});

const STORAGE_KEY = "wm:enable-banking-setup:step:user-1";

/** The server keeps the new key as its pending one, which the credential then reports. */
const createsTheCertificate: Mutate = (_input, { onSuccess }) => {
  h.credential = { ...PENDING, pending: { expiresAt: CERTIFICATE.expiresAt } };
  onSuccess?.(CERTIFICATE);
};
const apiError = (code: string) => ({
  response: { data: { code, message: "English server text" }, status: 400 },
});

/** A caller as the entry points are: a button that opens the wizard, and the bank list after it. */
function Host({ onChooseBank }: { onChooseBank: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open wizard
      </button>
      <EnableBankingSetupWizard entry="add_account" open={open} onOpenChange={setOpen} onChooseBank={onChooseBank} />
    </>
  );
}

async function openWizard(onChooseBank = vi.fn()) {
  const user = userEvent.setup();
  render(
    <NextIntlClientProvider locale="en" messages={enCommon} timeZone="UTC">
      <Host onChooseBank={onChooseBank} />
    </NextIntlClientProvider>,
  );
  await user.click(screen.getByRole("button", { name: "Open wizard" }));
  return { onChooseBank, user };
}

const heading = (name: string) => screen.getByRole("heading", { name });
const next = () => screen.getByRole("button", { name: "Next" });

test("step 1 opens Enable Banking's sign-in page in a new tab and links the guide", async () => {
  await openWizard();

  heading("Sign in to Enable Banking");
  assert.ok(screen.getByText("Step 1 of 4"));
  const signIn = screen.getByRole("link", { name: "Open Enable Banking" });
  assert.equal(signIn.getAttribute("href"), ENABLE_BANKING_SIGN_IN_URL);
  assert.equal(signIn.getAttribute("target"), "_blank");
  const guide = screen.getByRole("link", { name: "Step-by-step guide" });
  assert.match(guide.getAttribute("href") ?? "", /\/en\/docs\/start-here\/connect-first-bank-account$/);
});

test("step 2 lists this server's values to copy, warns about Production, and needs a certificate to go on", async () => {
  h.create.mockImplementation(createsTheCertificate);
  const { user } = await openWizard();
  // user-event puts its own clipboard in place on setup.
  const writeText = vi.spyOn(navigator.clipboard, "writeText");
  await user.click(next());

  heading("Create the application");
  assert.ok(screen.getByText("Environment: Production"));
  assert.ok(screen.getByText(/never reaches a real bank/));
  for (const value of Object.values(SETUP)) assert.ok(screen.getByDisplayValue(value));
  await user.click(screen.getByRole("button", { name: "Copy Redirect URL" }));
  assert.deepEqual(writeText.mock.calls.at(-1), [SETUP.redirectUrl]);
  await user.click(screen.getByRole("button", { name: "Copy Privacy URL" }));
  assert.deepEqual(writeText.mock.calls.at(-1), [SETUP.privacyUrl]);

  assert.equal((next() as HTMLButtonElement).disabled, true);
  await user.click(screen.getByRole("button", { name: "Create certificate" }));
  assert.deepEqual(h.create.mock.calls[0]?.[0], {});
  assert.ok(screen.getByRole("button", { name: "Download certificate" }));
  await user.click(screen.getByRole("button", { name: "Copy certificate" }));
  assert.deepEqual(writeText.mock.calls.at(-1), [CERTIFICATE.certificatePem]);
  assert.equal((next() as HTMLButtonElement).disabled, false);
});

test("step 2 asks for the authenticator code when two-factor is on, and sends it", async () => {
  h.session = { user: { id: "user-1", twoFactorEnabled: true } };
  window.localStorage.setItem(STORAGE_KEY, "create_application");
  const { user } = await openWizard();

  await user.type(screen.getByLabelText("Authenticator code"), "123456");
  await user.click(screen.getByRole("button", { name: "Create certificate" }));
  assert.deepEqual(h.create.mock.calls[0]?.[0], { totpCode: "123456" });
});

test("a certificate error is explained on step 2, and a code it asks for gets its field", async () => {
  h.create.mockImplementation((_input, { onError }) => onError?.(apiError("totp_required")));
  window.localStorage.setItem(STORAGE_KEY, "create_application");
  const { user } = await openWizard();

  assert.equal(screen.queryByLabelText("Authenticator code"), null);
  await user.click(screen.getByRole("button", { name: "Create certificate" }));
  assert.ok(screen.getByText("Enter your authenticator code to continue."));
  assert.ok(screen.getByLabelText("Authenticator code"));
});

test("step 3 says which activation button to press and which to skip", async () => {
  h.credential = PENDING;
  window.localStorage.setItem(STORAGE_KEY, "activate");
  const { user } = await openWizard();

  heading("Activate the application");
  assert.ok(screen.getByText("Activate by linking accounts"));
  assert.ok(screen.getByText("Request activation"));
  assert.ok(screen.getByText(/for businesses/));
  await user.click(screen.getByRole("button", { name: "Back" }));
  heading("Create the application");
});

test("steps 4 and 5: a pasted application ID is checked at once, then on to choosing the bank", async () => {
  h.credential = PENDING;
  h.activate.mockImplementation((_input, { onSuccess }) => onSuccess?.({}));
  const { onChooseBank, user } = await openWizard();
  heading("Create the application");
  await user.click(next());
  await user.click(next());

  heading("Paste the application ID");
  await user.click(screen.getByLabelText("Application ID"));
  await user.paste(`  ${APPLICATION_ID}\n`);
  await waitFor(() => assert.equal(h.activate.mock.calls.length, 1));
  assert.deepEqual(h.activate.mock.calls[0]?.[0], { applicationId: APPLICATION_ID });

  heading("Bank sync is ready");
  assert.equal(window.localStorage.getItem(STORAGE_KEY), null);
  await user.click(screen.getByRole("button", { name: "Choose your bank" }));
  assert.equal(onChooseBank.mock.calls.length, 1);
  assert.equal(screen.queryByRole("dialog"), null);
});

test("a typed application ID is checked with Activate", async () => {
  h.credential = PENDING;
  window.localStorage.setItem(STORAGE_KEY, "application_id");
  const { user } = await openWizard();

  const activate = screen.getByRole("button", { name: "Activate" });
  assert.equal((activate as HTMLButtonElement).disabled, true);
  await user.type(screen.getByLabelText("Application ID"), APPLICATION_ID);
  await user.click(activate);
  assert.deepEqual(h.activate.mock.calls[0]?.[0], { applicationId: APPLICATION_ID });
});

test.each([
  ["enable_banking_application_not_found", /doesn't recognise this application ID/, "Go to step 2: Create the application", "Create the application"],
  ["enable_banking_application_sandbox", /Sandbox application/, "Go to step 2: Create the application", "Create the application"],
  ["enable_banking_pending_credential_missing", /expired or was replaced/, "Go to step 2: Create the application", "Create the application"],
  ["enable_banking_credential_refused", /refused this key/, "Go to step 2: Create the application", "Create the application"],
  ["enable_banking_application_not_activated", /isn't activated yet/, "Go to step 3: Activate the application", "Activate the application"],
])("%s is explained and points to the step to revisit", async (code, message, revisit, revisitHeading) => {
  h.credential = PENDING;
  h.activate.mockImplementation((_input, { onError }) => onError?.(apiError(code)));
  window.localStorage.setItem(STORAGE_KEY, "application_id");
  const { user } = await openWizard();

  await user.type(screen.getByLabelText("Application ID"), APPLICATION_ID);
  await user.click(screen.getByRole("button", { name: "Activate" }));

  assert.match(screen.getByRole("alert").textContent ?? "", message);
  assert.equal(screen.queryByText("English server text"), null);
  assert.equal(screen.getByLabelText("Application ID").getAttribute("aria-invalid"), "true");
  await user.click(screen.getByRole("button", { name: revisit }));
  heading(revisitHeading);
  assert.equal(screen.queryByRole("alert"), null);
});

test.each([
  ["totp_required", "Enter your authenticator code to continue.", true],
  ["invalid_totp", "That authenticator code is not valid.", true],
  ["session_not_fresh", "For your security, sign in again before setting up your key.", false],
  ["anything_else", "Something went wrong. Please try again.", false],
])("%s stays on step 4 with its message", async (code, message, asksForCode) => {
  h.credential = PENDING;
  h.activate.mockImplementation((_input, { onError }) => onError?.(apiError(code)));
  window.localStorage.setItem(STORAGE_KEY, "application_id");
  const { user } = await openWizard();

  await user.type(screen.getByLabelText("Application ID"), APPLICATION_ID);
  await user.click(screen.getByRole("button", { name: "Activate" }));

  assert.equal(screen.getByRole("alert").textContent, message);
  assert.equal(screen.queryByRole("button", { name: /^Go to step/ }), null);
  assert.equal(Boolean(screen.queryByLabelText("Authenticator code")), asksForCode);
  heading("Paste the application ID");
});

test("with the authenticator code still to enter, a paste only fills the field", async () => {
  h.credential = PENDING;
  h.session = { user: { id: "user-1", twoFactorEnabled: true } };
  window.localStorage.setItem(STORAGE_KEY, "application_id");
  const { user } = await openWizard();

  await user.click(screen.getByLabelText("Application ID"));
  await user.paste(APPLICATION_ID);
  assert.equal(h.activate.mock.calls.length, 0);
  await user.type(screen.getByLabelText("Authenticator code"), "654321");
  await user.click(screen.getByRole("button", { name: "Activate" }));
  assert.deepEqual(h.activate.mock.calls[0]?.[0], { applicationId: APPLICATION_ID, totpCode: "654321" });
});

test("resume: closing and reopening comes back to the step, and the server's pending key outranks the browser", async () => {
  h.credential = PENDING;
  const { user } = await openWizard();
  // A certificate waits on the server: past sign-in, with its expiry and a way to replace it.
  heading("Create the application");
  assert.ok(screen.getByText(/A certificate is waiting until Dec 3, 2026/));
  assert.ok(screen.getByRole("button", { name: "Create a new certificate" }));
  await user.click(next());
  heading("Activate the application");
  assert.equal(window.localStorage.getItem(STORAGE_KEY), "activate");

  await user.keyboard("{Escape}");
  assert.equal(screen.queryByRole("dialog"), null);
  await user.click(screen.getByRole("button", { name: "Open wizard" }));
  heading("Activate the application");
});

test("resume: in a new browser session the remembered step and the server's credential decide where it opens", async () => {
  window.localStorage.setItem(STORAGE_KEY, "application_id");
  h.credential = PENDING;
  await openWizard();
  heading("Paste the application ID");
  cleanup();

  // The pending key lapsed: there is no certificate to register any more.
  h.credential = null;
  await openWizard();
  heading("Create the application");
  assert.equal((next() as HTMLButtonElement).disabled, true);
  cleanup();

  window.localStorage.removeItem(STORAGE_KEY);
  await openWizard();
  heading("Sign in to Enable Banking");
});

test("\"I already have a key\" leaves the wizard for the paste form, which also goes on to the bank list", async () => {
  window.localStorage.setItem(STORAGE_KEY, "create_application");
  const { onChooseBank, user } = await openWizard();

  await user.click(screen.getByRole("button", { name: "I already have a key" }));
  assert.equal(screen.queryByRole("heading", { name: "Create the application" }), null);
  assert.ok(screen.getByTestId("paste-key-form"));
  h.pasteDialog?.onSaved?.();
  assert.equal(onChooseBank.mock.calls.length, 1);
});

test("a certificate whose key was removed since is not offered again: step 2 creates a new one", async () => {
  h.create.mockImplementation(createsTheCertificate);
  window.localStorage.setItem(STORAGE_KEY, "create_application");
  const { user } = await openWizard();
  await user.click(screen.getByRole("button", { name: "Create certificate" }));
  assert.ok(screen.getByRole("button", { name: "Download certificate" }));

  await user.keyboard("{Escape}");
  // Removed in Settings (or lapsed): the server has no pending key any more.
  h.credential = null;
  await user.click(screen.getByRole("button", { name: "Open wizard" }));

  heading("Create the application");
  assert.equal(screen.queryByRole("button", { name: "Download certificate" }), null);
  assert.ok(screen.getByRole("button", { name: "Create certificate" }));
  assert.equal((next() as HTMLButtonElement).disabled, true);
});

test("pending_credential_missing drops the certificate, so step 2 offers a new one instead of looping", async () => {
  h.create.mockImplementation(createsTheCertificate);
  h.activate.mockImplementation((_input, { onError }) => {
    h.credential = null;
    onError?.(apiError("enable_banking_pending_credential_missing"));
  });
  window.localStorage.setItem(STORAGE_KEY, "create_application");
  const { user } = await openWizard();
  await user.click(screen.getByRole("button", { name: "Create certificate" }));
  await user.click(next());
  await user.click(next());
  await user.type(screen.getByLabelText("Application ID"), APPLICATION_ID);
  await user.click(screen.getByRole("button", { name: "Activate" }));

  await user.click(screen.getByRole("button", { name: "Go to step 2: Create the application" }));
  heading("Create the application");
  assert.equal(screen.queryByRole("button", { name: "Download certificate" }), null);
  assert.ok(screen.getByRole("button", { name: "Create certificate" }));
});

test("the authenticator code is cleared after every attempt, failed ones included", async () => {
  h.credential = PENDING;
  h.session = { user: { id: "user-1", twoFactorEnabled: true } };
  h.activate.mockImplementation((_input, { onError }) => onError?.(apiError("invalid_totp")));
  window.localStorage.setItem(STORAGE_KEY, "application_id");
  const { user } = await openWizard();

  await user.type(screen.getByLabelText("Application ID"), APPLICATION_ID);
  await user.type(screen.getByLabelText("Authenticator code"), "111111");
  await user.click(screen.getByRole("button", { name: "Activate" }));

  assert.equal((screen.getByLabelText("Authenticator code") as HTMLInputElement).value, "");
  assert.equal((screen.getByLabelText("Application ID") as HTMLInputElement).value, APPLICATION_ID);
});

test("a session too old to set up a key asks to sign in again before step 1, and comes back to the wizard", async () => {
  h.session = {
    session: { createdAt: new Date(Date.now() - 23.5 * 60 * 60 * 1000).toISOString() },
    user: { id: "user-1", twoFactorEnabled: false },
  };
  const assign = vi.fn();
  const originalLocation = window.location;
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { assign, origin: "http://localhost", pathname: "/en/settings", search: "?tab=bank-provider" },
  });
  try {
    const { user } = await openWizard();

    heading("Sign in again first");
    assert.equal(screen.queryByText("Step 1 of 4"), null);
    await user.click(screen.getByRole("button", { name: "Sign in again" }));

    await waitFor(() => assert.equal(assign.mock.calls.length, 1));
    assert.equal(h.signOut.mock.calls.length, 1);
    const login = new URL(String(assign.mock.calls[0]?.[0]));
    assert.equal(login.pathname, "/en/auth/login");
    assert.equal(login.searchParams.get("next"), "/en/settings?tab=bank-provider");
    assert.match(window.sessionStorage.getItem("wm:enable-banking-setup:reopen") ?? "", /"path":"\/en\/settings"/);
  } finally {
    Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
  }
});

test("back from signing in again, the wizard opens itself on that page, once", async () => {
  window.sessionStorage.setItem(
    "wm:enable-banking-setup:reopen",
    JSON.stringify({ at: Date.now(), path: window.location.pathname }),
  );
  render(
    <NextIntlClientProvider locale="en" messages={enCommon} timeZone="UTC">
      <Host onChooseBank={vi.fn()} />
      <Host onChooseBank={vi.fn()} />
    </NextIntlClientProvider>,
  );

  await waitFor(() => heading("Sign in to Enable Banking"));
  assert.equal(screen.getAllByRole("dialog").length, 1);
  assert.equal(window.sessionStorage.getItem("wm:enable-banking-setup:reopen"), null);
});

test("session_not_fresh on step 4 offers to sign in again", async () => {
  h.credential = PENDING;
  h.activate.mockImplementation((_input, { onError }) => onError?.(apiError("session_not_fresh")));
  window.localStorage.setItem(STORAGE_KEY, "application_id");
  const { user } = await openWizard();

  await user.type(screen.getByLabelText("Application ID"), APPLICATION_ID);
  await user.click(screen.getByRole("button", { name: "Activate" }));
  assert.ok(screen.getByRole("button", { name: "Sign in again" }));
});

test("the paste form opened from the wizard says Update when a key is already active", async () => {
  h.credential = { ...PENDING, applicationId: APPLICATION_ID, status: "active" };
  window.localStorage.setItem(STORAGE_KEY, "create_application");
  const { user } = await openWizard();

  await user.click(screen.getByRole("button", { name: "I already have a key" }));
  assert.equal(h.pasteDialog?.isUpdate, true);
});

/** What the wizard sent analytics, in order. */
const tracked = () => h.track.mock.calls.map(([event, properties]) => [event, properties]);
const viewed = (step: string) => ["bank_key_setup_step_viewed", { step }];
const STARTED = ["bank_key_setup_started", { entry: "add_account" }];

test("analytics: one started per opening, from its entry point, then each step shown once", async () => {
  h.create.mockImplementation(createsTheCertificate);
  const { user } = await openWizard();
  await user.click(next());
  await user.click(screen.getByRole("button", { name: "Back" }));
  await user.click(next());
  await user.click(screen.getByRole("button", { name: "Create certificate" }));
  await user.click(next());

  assert.deepEqual(tracked(), [STARTED, viewed("sign_in"), viewed("create_application"), viewed("activate")]);

  // Closing and opening again is another opening.
  await user.keyboard("{Escape}");
  await waitFor(() => assert.equal(screen.queryByRole("dialog"), null));
  await user.click(screen.getByRole("button", { name: "Open wizard" }));
  heading("Activate the application");
  assert.deepEqual(tracked().slice(4), [STARTED, viewed("activate")]);
});

test("analytics: a whole setup sends each step once, in order, and nothing it was given", async () => {
  h.session = { user: { id: "user-1", twoFactorEnabled: true } };
  h.create.mockImplementation(createsTheCertificate);
  h.activate.mockImplementation((_input, { onSuccess }) => onSuccess?.({}));
  const { user } = await openWizard();
  await user.click(next());
  await user.type(screen.getByLabelText("Authenticator code"), "123456");
  await user.click(screen.getByRole("button", { name: "Create certificate" }));
  await user.click(next());
  await user.click(next());
  await user.type(screen.getByLabelText("Application ID"), APPLICATION_ID);
  await user.type(screen.getByLabelText("Authenticator code"), "654321");
  await user.click(screen.getByRole("button", { name: "Activate" }));
  heading("Bank sync is ready");

  assert.deepEqual(tracked(), [
    STARTED,
    viewed("sign_in"),
    viewed("create_application"),
    viewed("activate"),
    viewed("application_id"),
    viewed("done"),
  ]);
  const sent = JSON.stringify(h.track.mock.calls);
  for (const secret of [APPLICATION_ID, "123456", "654321", "BEGIN CERTIFICATE", "user-1", SETUP.redirectUrl]) {
    assert.equal(sent.includes(secret), false, secret);
  }
});

test("analytics: a step behind the sign-in-again notice is not counted as shown", async () => {
  h.session = {
    session: { createdAt: new Date(Date.now() - 23.5 * 60 * 60 * 1000).toISOString() },
    user: { id: "user-1", twoFactorEnabled: false },
  };
  await openWizard();

  heading("Sign in again first");
  assert.deepEqual(tracked(), [STARTED]);
});

test("analytics: nothing is sent while the wizard is closed", () => {
  render(
    <NextIntlClientProvider locale="en" messages={enCommon} timeZone="UTC">
      <Host onChooseBank={vi.fn()} />
    </NextIntlClientProvider>,
  );

  assert.deepEqual(tracked(), []);
});
