// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, test, vi } from "vitest";

import enCommon from "../../../messages/en/common.json";
import EnableBankingGeneratedKeyDialog from "./EnableBankingGeneratedKeyDialog";

type Mutate = (input: unknown, handlers: { onError?: (error: unknown) => void; onSuccess?: (data: unknown) => void }) => void;

const state = vi.hoisted(() => ({
  activate: vi.fn<Mutate>(),
  create: vi.fn<Mutate>(),
}));

vi.mock("@/lib/api/user/useEnableBankingCredential", () => ({
  useActivateEnableBankingCredential: () => ({ isPending: false, mutate: state.activate }),
  useCreateEnableBankingCertificate: () => ({ isPending: false, mutate: state.create }),
}));
vi.mock("@/lib/api/instance/useInstance", () => ({
  useEnableBankingSetup: () => ({
    applicationDescription: "Personal use: reads my own bank accounts into WonderMoney.",
    applicationName: "WonderMoney",
    privacyUrl: "https://docs.example.test/privacy",
    redirectUrl: "https://api.example.test/v1/banking/enable-banking/callback",
    termsUrl: "https://docs.example.test/terms",
  }),
}));
vi.mock("@/lib/api/useRateLimitToast", () => ({ useRateLimitToast: () => () => false }));

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

afterEach(() => {
  cleanup();
  state.activate.mockReset();
  state.create.mockReset();
});

const apiError = (code: string) => ({ response: { data: { code, message: "English server text" }, status: 400 } });

function renderDialog(pendingExpiresAt: string | null = null) {
  render(
    <NextIntlClientProvider locale="en" messages={enCommon} timeZone="UTC">
      <EnableBankingGeneratedKeyDialog triggerLabel="Let WonderMoney create the key" pendingExpiresAt={pendingExpiresAt} />
    </NextIntlClientProvider>,
  );
}

test("creates a certificate, lists this server's Control Panel values, and activates with the application ID", async () => {
  state.create.mockImplementation((_input, { onSuccess }) => onSuccess?.({ certificatePem: "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n", expiresAt: "2026-12-03T00:00:00.000Z" }));
  const user = userEvent.setup();
  renderDialog();

  await user.click(screen.getByRole("button", { name: "Let WonderMoney create the key" }));
  const activate = screen.getByRole("button", { name: "Activate" });
  assert.equal((activate as HTMLButtonElement).disabled, true);
  await user.click(screen.getByRole("button", { name: "Create certificate" }));

  assert.ok(screen.getByRole("button", { name: "Download certificate" }));
  assert.ok(screen.getByRole("button", { name: "Copy certificate" }));
  assert.ok(screen.getByDisplayValue("https://api.example.test/v1/banking/enable-banking/callback"));
  assert.ok(screen.getByRole("button", { name: "Copy Redirect URL" }));
  assert.ok(screen.getByDisplayValue("https://docs.example.test/privacy"));
  assert.ok(screen.getByDisplayValue("https://docs.example.test/terms"));

  await user.type(screen.getByLabelText("3. Paste the application ID"), " 3fa85f64-5717-4562-b3fc-2c963f66afa6 ");
  await user.click(screen.getByRole("button", { name: "Activate" }));

  await waitFor(() => assert.equal(state.activate.mock.calls.length, 1));
  assert.deepEqual(state.activate.mock.calls[0]?.[0], { applicationId: "3fa85f64-5717-4562-b3fc-2c963f66afa6" });
});

test.each([
  ["enable_banking_application_not_found", /doesn't recognise this application ID.*clock/],
  ["enable_banking_application_sandbox", /Sandbox application/],
  ["enable_banking_application_not_activated", /isn't activated yet/],
  ["enable_banking_pending_credential_missing", /expired or was replaced/],
  ["enable_banking_credential_refused", /refused this key/],
])("explains %s in its own words", async (code, message) => {
  state.activate.mockImplementation((_input, { onError }) => onError?.(apiError(code)));
  const user = userEvent.setup();
  renderDialog("2026-12-03T00:00:00.000Z");

  await user.click(screen.getByRole("button", { name: "Let WonderMoney create the key" }));
  assert.ok(screen.getByText(/already waiting until/));
  await user.type(screen.getByLabelText("3. Paste the application ID"), "3fa85f64-5717-4562-b3fc-2c963f66afa6");
  await user.click(screen.getByRole("button", { name: "Activate" }));

  assert.ok(await screen.findByText(message));
  assert.equal(screen.queryByText("English server text"), null);
});
