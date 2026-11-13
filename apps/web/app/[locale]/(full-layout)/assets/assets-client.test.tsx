// @vitest-environment jsdom
import assert from "node:assert/strict";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, test, vi } from "vitest";

import type {
  CryptoChain,
  GetManualAssetsResponse,
  ManualAsset,
} from "@/lib/api/manual-asset/types";
import {
  cryptoWalletAsset,
  figure,
  manualAsset,
} from "@/lib/manual-assets/asset-fixture";

import enAssets from "../../../../messages/en/assets.json";
import enCommon from "../../../../messages/en/common.json";
import enNavigation from "../../../../messages/en/navigation.json";
import AssetsClient from "./assets-client";

const state = vi.hoisted(() => ({
  data: undefined as GetManualAssetsResponse | undefined,
  push: vi.fn(),
  chains: [] as CryptoChain[],
}));

vi.mock("@/lib/api/instance/useInstance", () => ({
  useCryptoWalletChains: () => state.chains,
}));
vi.mock("@/components/manual-asset/CryptoWalletFormDrawer", () => ({
  default: ({ open, chains }: { open: boolean; chains: string[] }) =>
    open ? <div data-testid="wallet-form">{chains.join(",")}</div> : null,
}));

vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push: state.push }),
}));
vi.mock("@/lib/api/manual-asset/useManualAssets", () => ({
  default: () => ({
    data: state.data,
    isPending: false,
    error: null,
    refetch: () => {},
  }),
}));
// The add drawer has its own tests; here it only has to stay closed.
vi.mock("@/components/manual-asset/ManualAssetFormDrawer", () => ({
  default: ({ open }: { open: boolean }) =>
    open ? <div data-testid="asset-form" /> : null,
}));

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

afterEach(() => {
  cleanup();
  state.push.mockReset();
  state.chains = [];
});

const m = enAssets.assets;

function renderPage(
  assets: ManualAsset[],
  summary: Partial<GetManualAssetsResponse["summary"]> = {},
) {
  state.data = {
    assets,
    summary: {
      currencyCode: "EUR",
      isComplete: true,
      totalValue: assets.reduce(
        (total, asset) => total + (asset.valueInUserCurrency ?? 0),
        0,
      ),
      unconvertedAssets: 0,
      unconvertedCurrencies: [],
      ...summary,
    },
  };
  render(
    <QueryClientProvider client={new QueryClient()}>
      <NextIntlClientProvider
        locale="en"
        messages={{ ...enCommon, ...enNavigation, ...enAssets }}
      >
        <AssetsClient />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

test("with no assets it explains what an asset is and offers to add one", async () => {
  const user = userEvent.setup();
  renderPage([]);

  screen.getByRole("heading", { name: m.empty.title });
  screen.getByText(m.empty.description);
  assert.equal(screen.queryByTestId("asset-form"), null);
  await user.click(screen.getByRole("button", { name: m.actions.add }));
  screen.getByTestId("asset-form");
});

test("lists each asset with its kind and value, and the household total", () => {
  renderPage([
    manualAsset(),
    manualAsset({
      manualAssetKey: 2,
      name: "Car",
      kind: "vehicle",
      value: 18_000,
      valueInUserCurrency: 18_000,
      isPrivate: true,
    }),
  ]);

  screen.getByRole("heading", { name: m.page.title });
  screen.getByText(figure("€268,000.00"));
  const rows = screen.getAllByRole("row").slice(1);
  // Sorted by name: the car first.
  assert.match(rows[0].textContent ?? "", /Car/);
  within(rows[0]).getByText(m.kinds.vehicle);
  within(rows[0]).getByText(m.table.private);
  within(rows[0]).getByText(figure("€18,000.00"));
  within(rows[1]).getByText(m.kinds.property);
  assert.equal(within(rows[1]).queryByText(m.table.private), null);
  // Every asset is in euros: no converted column.
  assert.equal(screen.queryByRole("columnheader", { name: "In EUR" }), null);
});

test("an asset with no exchange rate is shown in its own currency and left out of the total, said so", () => {
  renderPage(
    [
      manualAsset(),
      manualAsset({
        manualAssetKey: 3,
        name: "Flat in Lagos",
        currency: "NGN",
        currencyKey: 9,
        value: 90_000_000,
        valueInUserCurrency: null,
      }),
    ],
    {
      isComplete: false,
      unconvertedAssets: 1,
      unconvertedCurrencies: ["NGN"],
    },
  );

  screen.getByRole("columnheader", { name: "In EUR" });
  const flat = screen.getByRole("row", { name: /Flat in Lagos/ });
  within(flat).getByText(m.table.noRate);
  within(flat).getByText(figure(/NGN\s?90,000,000\.00/));
  screen.getByRole("note");
  screen.getByText(
    "1 asset is left out of the total: there is no exchange rate for NGN yet.",
  );
  // The total is only what converts, never the naira added at face value.
  assert.equal(screen.getAllByText(figure("€250,000.00")).length, 2);
});

test("archived assets sit apart, at their last value, and are not counted", () => {
  renderPage([
    manualAsset(),
    manualAsset({
      manualAssetKey: 4,
      name: "Old car",
      kind: "vehicle",
      archived: true,
      archivedAt: "2026-07-01",
      value: null,
      valueInUserCurrency: null,
      lastValuation: {
        manualAssetValuationKey: 200,
        date: "2026-05-01",
        value: 3000,
        note: null,
      },
    }),
  ]);

  const archived = screen.getByRole("region", { name: m.table.archivedTitle });
  within(archived).getByText("Old car");
  within(archived).getByText(figure("€3,000.00"));
  // One asset counted, and the total is the home alone.
  screen.getByText(m.summary.count);
  screen.getByText("1", { selector: "span" });
  assert.equal(screen.getAllByText(figure("€250,000.00")).length, 2);
});

test("a row opens the asset's page", async () => {
  const user = userEvent.setup();
  renderPage([manualAsset({ manualAssetKey: 42 })]);

  await user.click(screen.getByText("Family home"));
  assert.deepEqual(state.push.mock.calls, [["/assets/42"]]);
});

test("without a blockchain explorer on the server, no crypto wallet is offered", () => {
  renderPage([]);
  assert.equal(
    screen.queryByRole("button", { name: m.wallet.actions.add }),
    null,
  );
  cleanup();
  renderPage([manualAsset()]);
  assert.equal(
    screen.queryByRole("button", { name: m.wallet.actions.add }),
    null,
  );
});

test("with chains to read, a crypto wallet can be added on those chains", async () => {
  state.chains = ["bitcoin"];
  const user = userEvent.setup();
  renderPage([manualAsset()]);

  await user.click(screen.getByRole("button", { name: m.wallet.actions.add }));
  assert.equal(screen.getByTestId("wallet-form").textContent, "bitcoin");
  cleanup();

  renderPage([]);
  screen.getByRole("button", { name: m.wallet.actions.add });
});

test("a wallet is listed like any asset, as a crypto wallet in US dollars", () => {
  renderPage([manualAsset(), cryptoWalletAsset({ manualAssetKey: 2 })]);

  const row = screen.getByRole("row", { name: /Hardware wallet/ });
  within(row).getByText(m.kinds.crypto_wallet);
  within(row).getByText(figure(/\$1,200\.00/));
  within(row).getByText(figure("€1,100.00"));
});
