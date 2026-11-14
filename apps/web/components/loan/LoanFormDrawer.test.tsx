// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, beforeAll, test, vi } from "vitest";

import type { LoanDetail } from "@/lib/api/loan/types";
import type { ManualAsset } from "@/lib/api/manual-asset/types";
import { manualAsset } from "@/lib/manual-assets/asset-fixture";

import enCommon from "../../messages/en/common.json";
import enLoans from "../../messages/en/loans.json";
import LoanFormDrawer from "./LoanFormDrawer";

const state = vi.hoisted(() => ({
  assets: [] as ManualAsset[],
  create: vi.fn(),
  update: vi.fn(),
  onOpenChange: vi.fn(),
}));

vi.mock("@/lib/api/account/useCurrencies", () => ({
  default: () => ({
    data: {
      currencies: [{ currencyKey: 1, code: "EUR", description: "Euro" }],
    },
  }),
}));
vi.mock("@/lib/api/manual-asset/useManualAssets", () => ({
  default: () => ({ data: { assets: state.assets } }),
}));
vi.mock("@/lib/api/loan/useCreateLoan", () => ({
  default: () => ({ mutateAsync: state.create, isPending: false }),
}));
vi.mock("@/lib/api/loan/useUpdateLoan", () => ({
  default: () => ({ mutateAsync: state.update, isPending: false }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("@/components/ui/dialog-responsive", () => ({
  DrawerDialog: ({
    children,
    footer,
  }: {
    children: ReactNode;
    footer: ReactNode;
  }) => (
    <div>
      {children}
      {footer}
    </div>
  ),
}));

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});

afterEach(() => {
  cleanup();
  state.assets = [];
  for (const mock of [state.create, state.update, state.onOpenChange])
    mock.mockReset();
});

const m = enLoans.loans;

const home = manualAsset({ manualAssetKey: 7, name: "Family home" });
const car = manualAsset({ manualAssetKey: 8, name: "Car", kind: "vehicle" });
const soldFlat = manualAsset({
  manualAssetKey: 9,
  name: "Sold flat",
  archived: true,
  archivedAt: "2026-05-01T00:00:00.000Z",
  value: null,
  valueInUserCurrency: null,
});

const mortgage: LoanDetail = {
  currency: { code: "EUR", currencyKey: 1 },
  includeInNetWorth: true,
  loanKey: 5,
  name: "Home loan",
  openingBalanceDate: "2026-01-01",
  openingPrincipalBalance: 200_000,
  outstandingPrincipal: 180_000,
  securedAsset: {
    key: 7,
    name: "Family home",
    currency: "EUR",
    value: 250_000,
  },
  status: "ACTIVE",
  type: "MORTGAGE",
};

function renderForm(loan?: LoanDetail) {
  render(
    <NextIntlClientProvider locale="en" messages={{ ...enCommon, ...enLoans }}>
      <LoanFormDrawer open onOpenChange={state.onOpenChange} loan={loan} />
    </NextIntlClientProvider>,
  );
}

async function optionsOf(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByLabelText(m.fields.securedAsset));
  return (await screen.findAllByRole("option")).map(
    (option) => option.textContent,
  );
}

test("a new loan can be secured against an asset still held, and sends its key", async () => {
  state.assets = [home, car, soldFlat];
  state.create.mockResolvedValue({});
  const user = userEvent.setup();
  renderForm();

  await user.type(screen.getByLabelText(m.fields.name), "Home loan");
  // An archived asset is not offered for a new link.
  assert.deepEqual(await optionsOf(user), [
    m.fields.securedAssetNone,
    "Family home",
    "Car",
  ]);
  await user.click(screen.getByRole("option", { name: "Family home" }));
  await user.click(screen.getByRole("button", { name: m.actions.add }));

  await waitFor(() => assert.equal(state.create.mock.calls.length, 1));
  assert.equal(state.create.mock.calls[0][0].securedAssetKey, 7);
});

test("a new loan secured against nothing does not send the field", async () => {
  state.assets = [home];
  state.create.mockResolvedValue({});
  const user = userEvent.setup();
  renderForm();

  await user.type(screen.getByLabelText(m.fields.name), "Holiday loan");
  await user.click(screen.getByRole("button", { name: m.actions.add }));

  await waitFor(() => assert.equal(state.create.mock.calls.length, 1));
  assert.equal("securedAssetKey" in state.create.mock.calls[0][0], false);
});

test("clearing the asset on an edit unlinks it with null", async () => {
  state.assets = [home, car];
  state.update.mockResolvedValue({});
  const user = userEvent.setup();
  renderForm(mortgage);

  await optionsOf(user);
  await user.click(
    screen.getByRole("option", { name: m.fields.securedAssetNone }),
  );
  await user.click(screen.getByRole("button", { name: m.actions.save }));

  await waitFor(() => assert.equal(state.update.mock.calls.length, 1));
  const { loanId, payload } = state.update.mock.calls[0][0];
  assert.equal(loanId, 5);
  assert.equal(payload.securedAssetKey, null);
});

test("an edit sends a new asset, and leaves an untouched link alone", async () => {
  state.assets = [home, car];
  state.update.mockResolvedValue({});
  const user = userEvent.setup();
  renderForm(mortgage);

  await user.click(screen.getByRole("button", { name: m.actions.save }));
  await waitFor(() => assert.equal(state.update.mock.calls.length, 1));
  assert.equal(
    "securedAssetKey" in state.update.mock.calls[0][0].payload,
    false,
  );

  await optionsOf(user);
  await user.click(screen.getByRole("option", { name: "Car" }));
  await user.click(screen.getByRole("button", { name: m.actions.save }));
  await waitFor(() => assert.equal(state.update.mock.calls.length, 2));
  assert.equal(state.update.mock.calls[1][0].payload.securedAssetKey, 8);
});

test("the asset a loan is secured against stays offered once it is archived", async () => {
  state.assets = [home, soldFlat];
  const user = userEvent.setup();
  renderForm({
    ...mortgage,
    securedAsset: { key: 9, name: "Sold flat", currency: "EUR", value: null },
  });

  assert.deepEqual(await optionsOf(user), [
    m.fields.securedAssetNone,
    "Family home",
    "Sold flat",
  ]);
});
