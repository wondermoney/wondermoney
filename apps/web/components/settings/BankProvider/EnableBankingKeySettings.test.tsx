// @vitest-environment jsdom
import assert from "node:assert/strict";

import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, test, vi } from "vitest";

import enCommon from "../../../messages/en/common.json";
import EnableBankingKeySettings from "./EnableBankingKeySettings";

type Open = { isOpen?: boolean; open?: boolean };
type Mutate = (input: unknown, handlers: { onError?: (error: unknown) => void; onSuccess?: () => void }) => void;

const h = vi.hoisted(() => ({
  credential: null as null | { pending?: { expiresAt: string } | null; status: string },
  remove: vi.fn<Mutate>(),
  session: { user: { id: "user-1", twoFactorEnabled: false } } as {
    session?: { createdAt: string };
    user: { id: string; twoFactorEnabled: boolean };
  },
  signOut: vi.fn(async () => {}),
  viewer: false,
  wizard: null as null | { entry?: string; onChooseBank: () => void },
}));

vi.mock("@/lib/api/user/useEnableBankingCredential", () => ({
  default: () => ({ data: h.credential, error: null, isLoading: false }),
  useDeleteEnableBankingCredential: () => ({ isPending: false, mutate: h.remove }),
}));
vi.mock("@/lib/auth/client", () => ({ authClient: { signOut: h.signOut, useSession: () => ({ data: h.session }) } }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/lib/api/user/useProfile", () => ({ useProfileField: () => ({ data: false }) }));
vi.mock("@/lib/household/useIsHouseholdViewer", () => ({ useIsHouseholdViewer: () => h.viewer }));
vi.mock("@/lib/api/useRateLimitToast", () => ({ useRateLimitToast: () => () => false }));
vi.mock("./EnableBankingKeySetupDialog", () => ({ default: () => null }));
vi.mock("./EnableBankingSetupWizard", () => ({
  default: (props: Open & { entry: string; onChooseBank: () => void }) => {
    h.wizard = props;
    return props.open ? <div data-testid="setup-wizard" /> : null;
  },
}));
vi.mock("@/components/account/AccountCreateSyncModal", () => ({
  default: (props: Open) => (props.isOpen ? <div data-testid="bank-list" /> : null),
}));

beforeEach(() => {
  window.sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  h.credential = null;
  h.remove.mockReset();
  h.session = { user: { id: "user-1", twoFactorEnabled: false } };
  h.signOut.mockClear();
  h.viewer = false;
  h.wizard = null;
});

function renderSettings() {
  render(
    <NextIntlClientProvider locale="en" messages={enCommon} timeZone="UTC">
      <EnableBankingKeySettings />
    </NextIntlClientProvider>,
  );
}

const copy = enCommon.bankProvider;

test("Bank Provider settings open the setup wizard, and finishing it opens the bank list", async () => {
  renderSettings();

  await userEvent.click(screen.getByRole("button", { name: copy.createKeyCta }));
  screen.getByTestId("setup-wizard");
  assert.equal(h.wizard?.entry, "settings");
  act(() => h.wizard!.onChooseBank());
  screen.getByTestId("bank-list");
});

test("a certificate waiting for its application ID reads as setup to continue", () => {
  h.credential = { pending: { expiresAt: "2026-12-03T00:00:00.000Z" }, status: "pending" };
  renderSettings();

  screen.getByRole("button", { name: copy.continueSetup });
  screen.getByText(/waiting for its application ID until Dec 3, 2026/);
});

test("a household viewer, who cannot link a bank, is not offered the setup", () => {
  h.viewer = true;
  renderSettings();

  assert.equal(screen.queryByRole("button", { name: copy.createKeyCta }), null);
});

const ACTIVE = { applicationId: "3fa85f64-5717-4562-b3fc-2c963f66afa6", pending: null, status: "active" };
const apiError = (code: string) => ({ response: { data: { code, message: "English server text" }, status: 403 } });

async function openRemove() {
  const user = userEvent.setup();
  renderSettings();
  await user.click(screen.getByRole("button", { name: copy.removeKey }));
  const dialog = await screen.findByRole("alertdialog");
  return { dialog, user };
}

test("removing the key without two-factor asks for no code", async () => {
  h.credential = ACTIVE;
  const { dialog, user } = await openRemove();

  assert.equal(screen.queryByLabelText("Authenticator code"), null);
  await user.click(within(dialog).getByRole("button", { name: copy.removeDialogConfirm }));
  assert.deepEqual(h.remove.mock.calls[0]?.[0], {});
});

test("with two-factor on, Remove asks for the authenticator code, sends it, and clears it after a wrong one", async () => {
  h.credential = ACTIVE;
  h.session = { user: { id: "user-1", twoFactorEnabled: true } };
  h.remove.mockImplementationOnce((_input, { onError }) => onError?.(apiError("invalid_totp")));
  const { dialog, user } = await openRemove();

  await user.type(screen.getByLabelText("Authenticator code"), "111111");
  await user.click(within(dialog).getByRole("button", { name: copy.removeDialogConfirm }));

  assert.deepEqual(h.remove.mock.calls[0]?.[0], { totpCode: "111111" });
  assert.ok(await screen.findByText(copy.generated.errorInvalidTotp));
  assert.equal((screen.getByLabelText("Authenticator code") as HTMLInputElement).value, "");
});

test("a code the server asks for on Remove gets its field", async () => {
  h.credential = ACTIVE;
  h.remove.mockImplementationOnce((_input, { onError }) => onError?.(apiError("totp_required")));
  const { dialog, user } = await openRemove();

  await user.click(within(dialog).getByRole("button", { name: copy.removeDialogConfirm }));
  assert.ok(await screen.findByText(copy.generated.errorTotpRequired));
  assert.ok(screen.getByLabelText("Authenticator code"));
});

test("a session too old to remove the key asks to sign in again, and comes back to Remove", async () => {
  h.credential = ACTIVE;
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
    const { dialog, user } = await openRemove();

    screen.getByText(copy.removeSignInAgain);
    assert.equal(within(dialog).queryByRole("button", { name: copy.removeDialogConfirm }), null);
    await user.click(within(dialog).getByRole("button", { name: copy.wizard.signInAgain.action }));

    await waitFor(() => assert.equal(assign.mock.calls.length, 1));
    assert.equal(h.signOut.mock.calls.length, 1);
    assert.equal(h.remove.mock.calls.length, 0);
    const login = new URL(String(assign.mock.calls[0]?.[0]));
    assert.equal(login.searchParams.get("next"), "/en/settings?tab=bank-provider");
    assert.match(window.sessionStorage.getItem("wm:enable-banking-setup:reopen") ?? "", /"target":"remove"/);
  } finally {
    Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
  }
});

test("session_not_fresh on Remove offers to sign in again", async () => {
  h.credential = ACTIVE;
  h.remove.mockImplementation((_input, { onError }) => onError?.(apiError("session_not_fresh")));
  const { dialog, user } = await openRemove();

  await user.click(within(dialog).getByRole("button", { name: copy.removeDialogConfirm }));
  assert.ok(await within(dialog).findByRole("button", { name: copy.wizard.signInAgain.action }));
  screen.getByText(copy.removeSignInAgain);
});

test("back from signing in again to remove the key, Remove asks again", async () => {
  h.credential = ACTIVE;
  window.sessionStorage.setItem(
    "wm:enable-banking-setup:reopen",
    JSON.stringify({ at: Date.now(), path: window.location.pathname, target: "remove" }),
  );
  renderSettings();

  const dialog = await screen.findByRole("alertdialog");
  within(dialog).getByRole("button", { name: copy.removeDialogConfirm });
  assert.equal(window.sessionStorage.getItem("wm:enable-banking-setup:reopen"), null);
});
