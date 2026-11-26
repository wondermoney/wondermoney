// @vitest-environment jsdom
import assert from "node:assert/strict";

import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, test, vi } from "vitest";

import enCommon from "../../../messages/en/common.json";
import EnableBankingKeySettings from "./EnableBankingKeySettings";

type Open = { isOpen?: boolean; open?: boolean };

const h = vi.hoisted(() => ({
  credential: null as null | { pending?: { expiresAt: string } | null; status: string },
  viewer: false,
  wizard: null as null | { onChooseBank: () => void },
}));

vi.mock("@/lib/api/user/useEnableBankingCredential", () => ({
  default: () => ({ data: h.credential, error: null, isLoading: false }),
  useDeleteEnableBankingCredential: () => ({ isPending: false, mutate: vi.fn() }),
}));
vi.mock("@/lib/api/user/useProfile", () => ({ useProfileField: () => ({ data: false }) }));
vi.mock("@/lib/household/useIsHouseholdViewer", () => ({ useIsHouseholdViewer: () => h.viewer }));
vi.mock("@/lib/api/useRateLimitToast", () => ({ useRateLimitToast: () => () => false }));
vi.mock("./EnableBankingKeySetupDialog", () => ({ default: () => null }));
vi.mock("./EnableBankingSetupWizard", () => ({
  default: (props: Open & { onChooseBank: () => void }) => {
    h.wizard = props;
    return props.open ? <div data-testid="setup-wizard" /> : null;
  },
}));
vi.mock("@/components/account/AccountCreateSyncModal", () => ({
  default: (props: Open) => (props.isOpen ? <div data-testid="bank-list" /> : null),
}));

afterEach(() => {
  cleanup();
  h.credential = null;
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
