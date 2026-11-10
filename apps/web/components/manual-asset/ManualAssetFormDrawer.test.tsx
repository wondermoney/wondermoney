// @vitest-environment jsdom
import assert from "node:assert/strict";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, test, vi } from "vitest";

import type { ManualAsset } from "@/lib/api/manual-asset/types";
import { manualAsset } from "@/lib/manual-assets/asset-fixture";
import { dayString } from "@/lib/manual-assets/asset-view";

import enAssets from "../../messages/en/assets.json";
import enCommon from "../../messages/en/common.json";
import enNavigation from "../../messages/en/navigation.json";
import ManualAssetFormDrawer from "./ManualAssetFormDrawer";

const state = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  onCreated: vi.fn(),
  onOpenChange: vi.fn(),
}));

vi.mock("@/lib/api/account/useCurrencies", () => ({
  default: () => ({
    data: {
      currencies: [
        { currencyKey: 151, code: "EUR", description: "Euro" },
        { currencyKey: 152, code: "USD", description: "US Dollar" },
      ],
    },
  }),
}));
vi.mock("@/lib/api/manual-asset/useManualAssetMutations", () => ({
  useCreateManualAsset: () => ({ mutateAsync: state.create, isPending: false }),
  useUpdateManualAsset: () => ({ mutateAsync: state.update, isPending: false }),
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
  window.matchMedia ??= ((query: string) => ({
    matches: true,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  cleanup();
  for (const mock of Object.values(state)) mock.mockReset();
});

const m = enAssets.assets;

function renderDrawer(asset?: ManualAsset) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <NextIntlClientProvider
        locale="en"
        messages={{ ...enCommon, ...enNavigation, ...enAssets }}
      >
        <ManualAssetFormDrawer
          open
          onOpenChange={state.onOpenChange}
          asset={asset}
          userCurrency="EUR"
          onCreated={state.onCreated}
        />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

test("adds an asset in the viewer's currency, valued today, with no transaction fields", async () => {
  const created = manualAsset({ manualAssetKey: 7 });
  state.create.mockResolvedValue(created);
  const user = userEvent.setup();
  renderDrawer();

  await user.type(
    screen.getByLabelText(new RegExp(m.fields.name)),
    "Family home",
  );
  await user.type(
    screen.getByLabelText(new RegExp(m.fields.value)),
    "250,000.50",
  );
  await user.type(screen.getByLabelText(m.fields.purchasePrice), "200000");
  await user.click(screen.getByRole("button", { name: m.actions.add }));

  await waitFor(() => assert.equal(state.create.mock.calls.length, 1));
  assert.deepEqual(state.create.mock.calls[0][0], {
    name: "Family home",
    kind: "property",
    currencyKey: 151,
    value: 250_000.5,
    valuationDate: dayString(new Date()),
    purchasePrice: 200_000,
    purchaseDate: null,
    growthRule: null,
    notes: null,
    isPrivate: false,
  });
  assert.deepEqual(state.onCreated.mock.calls, [[created]]);
  assert.deepEqual(state.onOpenChange.mock.calls, [[false]]);
});

test("a negative yearly change is a depreciation rule, and the private switch keeps it to the owner", async () => {
  state.create.mockResolvedValue(manualAsset());
  const user = userEvent.setup();
  renderDrawer();

  await user.type(screen.getByLabelText(new RegExp(m.fields.name)), "Car");
  await user.type(screen.getByLabelText(new RegExp(m.fields.value)), "18000");
  await user.type(screen.getByLabelText(m.fields.growthRate), "-15.5");
  await user.click(screen.getByRole("switch"));
  await user.click(screen.getByRole("button", { name: m.actions.add }));

  await waitFor(() => assert.equal(state.create.mock.calls.length, 1));
  const payload = state.create.mock.calls[0][0];
  assert.deepEqual(payload.growthRule, {
    annualRatePercent: -15.5,
    startDate: null,
  });
  assert.equal(payload.isPrivate, true);
});

test("an amount it cannot read is an error, never another number", async () => {
  const user = userEvent.setup();
  renderDrawer();

  await user.type(screen.getByLabelText(new RegExp(m.fields.name)), "Watch");
  await user.type(screen.getByLabelText(new RegExp(m.fields.value)), "a lot");
  await user.click(screen.getByRole("button", { name: m.actions.add }));

  await screen.findByText(enCommon["invalid-amount"]);
  assert.equal(state.create.mock.calls.length, 0);
});

test("editing changes the details only: the value moves through Update value", async () => {
  state.update.mockResolvedValue(manualAsset());
  const user = userEvent.setup();
  renderDrawer(manualAsset({ manualAssetKey: 3, isPrivate: true }));

  assert.equal(screen.queryByLabelText(new RegExp(m.fields.value)), null);
  const name = screen.getByLabelText(new RegExp(m.fields.name));
  await user.clear(name);
  await user.type(name, "Lisbon flat");
  await user.click(screen.getByRole("button", { name: m.actions.save }));

  await waitFor(() => assert.equal(state.update.mock.calls.length, 1));
  assert.deepEqual(state.update.mock.calls[0][0], {
    manualAssetId: 3,
    payload: {
      name: "Lisbon flat",
      kind: "property",
      purchasePrice: null,
      purchaseDate: null,
      growthRule: null,
      notes: null,
      isPrivate: true,
    },
  });
});

test("the member who does not own a shared asset cannot change its privacy, and the form never sends it", async () => {
  state.update.mockResolvedValue(manualAsset());
  const user = userEvent.setup();
  renderDrawer(manualAsset({ isOwner: false }));

  assert.equal(screen.queryByRole("switch"), null);
  screen.getByText(m.detail.ownerOnlyPrivacy);
  await user.click(screen.getByRole("button", { name: m.actions.save }));

  await waitFor(() => assert.equal(state.update.mock.calls.length, 1));
  assert.equal("isPrivate" in state.update.mock.calls[0][0].payload, false);
});
