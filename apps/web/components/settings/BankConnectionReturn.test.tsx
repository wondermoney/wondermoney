// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, test, vi } from "vitest";

import { saveBankAccountSyncReturnMarker } from "@/lib/account/bank-account-sync-return-marker";

import enCommon from "../../messages/en/common.json";
import BankConnectionReturn from "./BankConnectionReturn";

const h = vi.hoisted(() => ({
  params: new URLSearchParams(),
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useSearchParams: () => h.params }));
vi.mock("@/i18n/navigation", () => ({
  usePathname: () => "/settings",
  useRouter: () => ({ replace: h.replace }),
}));

beforeEach(() => window.sessionStorage.clear());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  h.replace.mockClear();
  h.params = new URLSearchParams();
});

function landOnSettings(result?: string) {
  h.params = new URLSearchParams({ tab: "bank-provider" });
  if (result) h.params.set("enableBankingConnection", result);
  render(
    <NextIntlClientProvider locale="en" messages={enCommon}>
      <BankConnectionReturn />
    </NextIntlClientProvider>,
  );
}

const navigatedTo = () => h.replace.mock.calls.map((call) => call[0] as string);

test("a connection started in onboarding goes back to the onboarding sync step, in its locale", () => {
  saveBankAccountSyncReturnMarker("pt/onboarding/sync");
  landOnSettings("success");

  assert.deepEqual(h.replace.mock.calls, [
    ["/onboarding/sync?bankConnection=success", { locale: "pt" }],
  ]);
  assert.equal(screen.queryByRole("status"), null);
});

test("a connection started from Accounts goes back to Accounts", () => {
  saveBankAccountSyncReturnMarker("accounts");
  landOnSettings("success");

  assert.deepEqual(navigatedTo(), ["/accounts?bankConnection=success"]);
});

test("a connection started from a budget goes back to that budget month", () => {
  saveBankAccountSyncReturnMarker("/budgets/12/2026/3");
  landOnSettings("success");

  assert.deepEqual(navigatedTo(), ["/budgets/12/2026/3?bankConnection=success"]);
});

test("a failed connection also goes back, carrying the error for the page to show", () => {
  saveBankAccountSyncReturnMarker("en/onboarding/sync");
  landOnSettings("error");
  assert.deepEqual(navigatedTo(), ["/onboarding/account?bankConnection=error"]);

  cleanup();
  h.replace.mockClear();
  saveBankAccountSyncReturnMarker("/budgets/12/2026");
  landOnSettings("error");
  assert.deepEqual(navigatedTo(), ["/budgets/12/2026?bankConnection=error"]);
});

test("with nothing to go back to, Settings says the bank is connected and drops the flag from the URL", () => {
  landOnSettings("success");

  screen.getByRole("status");
  screen.getByText(enCommon["bank-connection-return-success-title"]);
  assert.deepEqual(navigatedTo(), ["/settings?tab=bank-provider"]);
});

test("with nothing to go back to, a failure is shown as an alert on Settings", () => {
  landOnSettings("error");

  const alert = screen.getByRole("alert");
  assert.match(alert.textContent ?? "", new RegExp(enCommon["bank-connection-return-error-title"]));
  assert.deepEqual(navigatedTo(), ["/settings?tab=bank-provider"]);
});

test("an expired marker is ignored", () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  saveBankAccountSyncReturnMarker("accounts");
  vi.setSystemTime(Date.now() + 31 * 60 * 1000);

  landOnSettings("success");

  assert.deepEqual(navigatedTo(), ["/settings?tab=bank-provider"]);
  screen.getByRole("status");
});

test("a marker naming a page the app never saves is ignored", () => {
  saveBankAccountSyncReturnMarker("https://evil.example/accounts");
  landOnSettings("success");

  assert.deepEqual(navigatedTo(), ["/settings?tab=bank-provider"]);
});

test("a plain Settings visit leaves the marker for the real return", () => {
  saveBankAccountSyncReturnMarker("accounts");
  landOnSettings();

  assert.deepEqual(navigatedTo(), []);
  assert.equal(screen.queryByRole("status"), null);
  assert.notEqual(window.sessionStorage.length, 0);
});
