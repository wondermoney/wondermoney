// @vitest-environment jsdom
import assert from "node:assert/strict";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AxiosError, AxiosHeaders } from "axios";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, beforeAll, test, vi } from "vitest";

import type {
  CryptoWalletDto,
  GetManualAssetResponse,
  ManualAssetValuation,
} from "@/lib/api/manual-asset/types";
import {
  cryptoWallet,
  cryptoWalletAsset,
  figure,
  manualAsset,
} from "@/lib/manual-assets/asset-fixture";

import enAssets from "../../../../../messages/en/assets.json";
import enCommon from "../../../../../messages/en/common.json";
import enNavigation from "../../../../../messages/en/navigation.json";
import AssetDetailClient from "./asset-detail-client";

const state = vi.hoisted(() => ({
  data: undefined as GetManualAssetResponse | undefined,
  isError: false,
  push: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  removeValuation: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  track: vi.fn(),
  sync: vi.fn(),
  addAddress: vi.fn(),
  updateLabel: vi.fn(),
  removeAddress: vi.fn(),
}));

vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
  useRouter: () => ({ push: state.push }),
}));
vi.mock("sonner", () => ({
  toast: { error: state.toastError, success: state.toastSuccess },
}));
vi.mock("@/lib/api/instance/useInstance", () => ({
  useCryptoWalletChains: () => ["bitcoin", "ethereum"],
}));
vi.mock("@/lib/api/manual-asset/useCryptoWalletMutations", () => ({
  useSyncCryptoWallet: () => ({ mutateAsync: state.sync, isPending: false }),
  useSetWalletTokenTracked: () => ({
    mutateAsync: state.track,
    isPending: false,
  }),
  useAddWalletAddress: () => ({
    mutateAsync: state.addAddress,
    isPending: false,
  }),
  useUpdateWalletAddressLabel: () => ({
    mutateAsync: state.updateLabel,
    isPending: false,
  }),
  useRemoveWalletAddress: () => ({
    mutateAsync: state.removeAddress,
    isPending: false,
  }),
}));
vi.mock("@/lib/api/manual-asset/useManualAsset", () => ({
  default: () => ({
    data: state.isError ? undefined : state.data,
    isPending: false,
    isError: state.isError,
  }),
}));
vi.mock("@/lib/api/manual-asset/useManualAssetMutations", () => ({
  useUpdateManualAsset: () => ({ mutateAsync: state.update, isPending: false }),
  useDeleteManualAsset: () => ({ mutateAsync: state.remove, isPending: false }),
  useDeleteValuation: () => ({
    mutateAsync: state.removeValuation,
    isPending: false,
  }),
}));
// The drawers and the chart have their own tests; here they report how they were opened.
vi.mock("@/components/manual-asset/ValuationDrawer", () => ({
  default: ({
    open,
    valuation,
  }: {
    open: boolean;
    valuation: ManualAssetValuation | null;
  }) =>
    open ? (
      <div data-testid="valuation-drawer">
        {valuation ? `editing ${valuation.manualAssetValuationKey}` : "new"}
      </div>
    ) : null,
}));
vi.mock("@/components/manual-asset/ManualAssetFormDrawer", () => ({
  default: ({ open }: { open: boolean }) =>
    open ? <div data-testid="asset-form" /> : null,
}));
vi.mock("@/components/manual-asset/ManualAssetValueChart", () => ({
  default: ({ history, stepped }: { history: unknown[]; stepped: boolean }) => (
    <div data-testid="value-chart">
      {history.length} points, {stepped ? "stepped" : "smooth"}
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
  window.matchMedia ??= ((query: string) => ({
    matches: true,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  cleanup();
  state.isError = false;
  for (const mock of [
    state.push,
    state.update,
    state.remove,
    state.removeValuation,
    state.toastError,
    state.toastSuccess,
    state.track,
    state.sync,
    state.addAddress,
    state.updateLabel,
    state.removeAddress,
  ])
    mock.mockReset();
});

const m = enAssets.assets;

const older: ManualAssetValuation = {
  manualAssetValuationKey: 99,
  date: "2025-01-10",
  value: 200_000,
  note: "Purchase",
};
const latest: ManualAssetValuation = {
  manualAssetValuationKey: 100,
  date: "2026-06-01",
  value: 250_000,
  note: "Agent estimate",
};

function renderDetail(
  overrides: Parameters<typeof manualAsset>[0] = {},
  valuations: ManualAssetValuation[] = [latest, older],
  wallet: CryptoWalletDto | null = null,
) {
  const asset = wallet
    ? cryptoWalletAsset({ lastValuation: valuations[0] ?? null, ...overrides })
    : manualAsset({ lastValuation: valuations[0], ...overrides });
  state.data = {
    asset,
    valuations,
    history: [...valuations]
      .reverse()
      .map(({ date, value }) => ({ date, value })),
    wallet,
  };
  render(
    <QueryClientProvider client={new QueryClient()}>
      <NextIntlClientProvider
        locale="en"
        timeZone="UTC"
        messages={{ ...enCommon, ...enNavigation, ...enAssets }}
      >
        <AssetDetailClient assetId={String(asset.manualAssetKey)} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

test("shows today's value, a stepped chart and the valuations newest first", () => {
  renderDetail({ purchasePrice: 200_000, purchaseDate: "2025-01-10" });

  screen.getByRole("heading", { name: "Family home" });
  screen.getByText(m.detail.valueLabel);
  assert.equal(
    screen.getByTestId("value-chart").textContent,
    "2 points, stepped",
  );

  const table = screen.getByRole("table");
  const rows = within(table).getAllByRole("row").slice(1);
  assert.match(rows[0].textContent ?? "", /Jun 1, 2026.*Agent estimate/);
  assert.match(rows[1].textContent ?? "", /Jan 10, 2025.*Purchase/);

  // Up 50,000 on the purchase price, with a sign and not only a colour.
  screen.getByText(figure("+€50,000.00"));
  screen.getByText("+25%");
  screen.getByText(m.detail.facts.shared);
});

test("a growth rule draws a smooth line and says the value is estimated", () => {
  renderDetail({
    value: 262_500,
    valueInUserCurrency: 262_500,
    growthRule: { annualRatePercent: 5, startDate: null },
  });

  assert.equal(
    screen.getByTestId("value-chart").textContent,
    "2 points, smooth",
  );
  screen.getByText(
    "Estimated from the yearly change since the valuation of Jun 1, 2026.",
  );
  screen.getByText("+5%");
});

test("Update value records a new valuation; Edit corrects that one", async () => {
  const user = userEvent.setup();
  renderDetail();

  await user.click(screen.getByRole("button", { name: m.actions.updateValue }));
  assert.equal(screen.getByTestId("valuation-drawer").textContent, "new");

  await user.keyboard("{Escape}");
  cleanup();
  renderDetail();
  const [firstEdit] = screen.getAllByRole("button", {
    name: m.detail.valuations.edit,
  });
  await user.click(firstEdit);
  assert.equal(
    screen.getByTestId("valuation-drawer").textContent,
    "editing 100",
  );
});

test("an asset in another currency shows the converted value, or says there is no rate", () => {
  renderDetail({
    currency: "USD",
    value: 300_000,
    valueInUserCurrency: 276_000,
  });
  screen.getByText(figure("€276,000.00"));
  cleanup();

  renderDetail({
    currency: "NGN",
    value: 90_000_000,
    valueInUserCurrency: null,
  });
  screen.getByRole("note");
  screen.getByText(
    "1 asset is left out of the total: there is no exchange rate for NGN yet.",
  );
  // No converted figure is made up from a missing rate.
  assert.equal(screen.queryByText(figure(/^€/)), null);
});

test("the owner's private asset says only they see it", () => {
  renderDetail({ isPrivate: true });
  screen.getByText(m.table.private);
  screen.getByText(m.detail.facts.private);
  assert.equal(screen.queryByText(m.detail.facts.owner), null);
});

test("a shared asset the other member owns names its owner", () => {
  renderDetail({ isOwner: false, ownerFirstName: "Rui" });
  screen.getByText(m.detail.facts.owner);
  screen.getByText("Rui");
});

test("an asset that cannot be loaded, such as the other member's private one, says why", async () => {
  state.isError = true;
  const user = userEvent.setup();
  renderDetail();

  screen.getByRole("heading", { name: m.detail.errors.loadFailed });
  screen.getByText(m.detail.errors.loadFailedBody);
  await user.click(screen.getByRole("button", { name: m.actions.back }));
  assert.deepEqual(state.push.mock.calls, [["/assets"]]);
});

test("deleting asks first, and cancelling deletes nothing", async () => {
  state.remove.mockResolvedValue(undefined);
  const user = userEvent.setup();
  renderDetail();

  await user.click(screen.getByRole("button", { name: m.actions.delete }));
  const dialog = screen.getByRole("alertdialog");
  within(dialog).getByText(m.detail.deleteConfirm);
  await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
  assert.equal(state.remove.mock.calls.length, 0);

  await user.click(screen.getByRole("button", { name: m.actions.delete }));
  await user.click(
    within(screen.getByRole("alertdialog")).getByRole("button", {
      name: m.actions.delete,
    }),
  );
  await waitFor(() => assert.deepEqual(state.remove.mock.calls, [[1]]));
  assert.deepEqual(state.push.mock.calls, [["/assets"]]);
});

test("archiving asks first; bringing it back does not", async () => {
  state.update.mockResolvedValue(manualAsset());
  const user = userEvent.setup();
  renderDetail();

  await user.click(screen.getByRole("button", { name: m.actions.archive }));
  within(screen.getByRole("alertdialog")).getByText(m.detail.archiveConfirm);
  await user.click(
    within(screen.getByRole("alertdialog")).getByRole("button", {
      name: m.actions.archive,
    }),
  );
  await waitFor(() =>
    assert.deepEqual(state.update.mock.calls, [
      [{ manualAssetId: 1, payload: { archived: true } }],
    ]),
  );
  cleanup();
  state.update.mockClear();

  renderDetail({
    archived: true,
    archivedAt: "2026-07-01T09:00:00.000Z",
    value: null,
    valueInUserCurrency: null,
  });
  // No value today: the header shows the last one, and there is nothing to update.
  screen.getByText(m.table.lastValued);
  assert.equal(
    screen.queryByRole("button", { name: m.actions.updateValue }),
    null,
  );
  await user.click(screen.getByRole("button", { name: m.actions.unarchive }));
  assert.equal(screen.queryByRole("alertdialog"), null);
  await waitFor(() =>
    assert.deepEqual(state.update.mock.calls, [
      [{ manualAssetId: 1, payload: { archived: false } }],
    ]),
  );
});

test("a valuation is removed after confirming, and the last one cannot be", async () => {
  state.removeValuation.mockResolvedValue(undefined);
  const user = userEvent.setup();
  renderDetail();

  const [, removeOlder] = screen.getAllByRole("button", {
    name: m.detail.valuations.remove,
  });
  await user.click(removeOlder);
  await user.click(
    within(screen.getByRole("alertdialog")).getByRole("button", {
      name: m.detail.valuations.remove,
    }),
  );
  await waitFor(() =>
    assert.deepEqual(state.removeValuation.mock.calls, [
      [{ manualAssetId: 1, valuationId: 99 }],
    ]),
  );
  cleanup();

  renderDetail({}, [latest]);
  assert.equal(
    screen.queryByRole("button", { name: m.detail.valuations.remove }),
    null,
  );
});

test("the API refusing to remove the last valuation is explained", async () => {
  state.removeValuation.mockRejectedValue(
    new AxiosError("Conflict", "409", undefined, undefined, {
      status: 409,
      statusText: "Conflict",
      headers: {},
      config: { headers: new AxiosHeaders() },
      data: { code: "manual_asset_last_valuation", message: "Keeps one" },
    }),
  );
  const user = userEvent.setup();
  renderDetail();

  await user.click(
    screen.getAllByRole("button", { name: m.detail.valuations.remove })[0],
  );
  await user.click(
    within(screen.getByRole("alertdialog")).getByRole("button", {
      name: m.detail.valuations.remove,
    }),
  );
  await waitFor(() =>
    assert.deepEqual(state.toastError.mock.calls, [
      [m.detail.valuations.lastOne],
    ]),
  );
});

const equityHeading = () =>
  screen.queryByRole("heading", { name: m.detail.equity.title });

test("an asset with no loans secured against it shows no equity", () => {
  renderDetail();
  assert.equal(equityHeading(), null);
});

test("an asset securing loans shows its value, the debt and the equity, and links each loan", () => {
  renderDetail({
    linkedLoans: [
      {
        loanKey: 5,
        name: "Home loan",
        currency: "EUR",
        outstandingPrincipal: 150_000,
        outstandingPrincipalInAssetCurrency: 150_000,
      },
      {
        loanKey: 6,
        name: "Renovation loan",
        currency: "USD",
        outstandingPrincipal: 22_000,
        outstandingPrincipalInAssetCurrency: 20_000,
      },
    ],
    linkedDebt: 170_000,
    equity: 80_000,
  });

  const section = equityHeading()!.closest("section")!;
  within(section).getByText(m.detail.equity.linkedDebt);
  within(section).getByText(figure("€170,000.00"));
  within(section).getByText(figure("€80,000.00"));

  const homeLoan = within(section).getByRole("link", { name: "Home loan" });
  assert.equal(homeLoan.getAttribute("href"), "/loans/5");
  within(section).getByText(figure("€150,000.00"));
  // A loan in another currency shows its own balance, and the converted one beside it.
  const renovation = within(section).getByRole("link", {
    name: "Renovation loan",
  });
  assert.equal(renovation.getAttribute("href"), "/loans/6");
  within(section).getByText(figure("$22,000.00"));
  within(section).getByText(figure("€20,000.00"));
  assert.equal(within(section).queryByRole("note"), null);
});

test("with no rate for a loan's currency, it says so and makes up no debt or equity", () => {
  renderDetail({
    linkedLoans: [
      {
        loanKey: 5,
        name: "Home loan",
        currency: "EUR",
        outstandingPrincipal: 150_000,
        outstandingPrincipalInAssetCurrency: 150_000,
      },
      {
        loanKey: 6,
        name: "Naira loan",
        currency: "NGN",
        outstandingPrincipal: 9_000_000,
        outstandingPrincipalInAssetCurrency: null,
      },
    ],
    linkedDebt: null,
    equity: null,
    unconvertedLoanCurrencies: ["NGN"],
  });

  const section = equityHeading()!.closest("section")!;
  assert.match(within(section).getByRole("note").textContent ?? "", /NGN/);
  // The value and the euro loan's balance, and nothing that adds them up.
  const euros = within(section)
    .getAllByText(figure(/^€[\d,.]+$/))
    .map((node) => node.textContent?.replace(/\s+/g, ""));
  assert.deepEqual(euros, ["€250,000.00", "€150,000.00"]);
  within(section).getByText(figure("NGN 9,000,000.00"));
});

test("an underwater asset shows the negative equity with a sign and a note, not colour alone", () => {
  renderDetail({
    value: 140_000,
    valueInUserCurrency: 140_000,
    linkedLoans: [
      {
        loanKey: 5,
        name: "Home loan",
        currency: "EUR",
        outstandingPrincipal: 150_000,
        outstandingPrincipalInAssetCurrency: 150_000,
      },
    ],
    linkedDebt: 150_000,
    equity: -10_000,
  });

  const section = equityHeading()!.closest("section")!;
  within(section).getByText(figure("−€10,000.00"));
  within(section).getByRole("note");
});

const w = m.wallet;

const walletValuation: ManualAssetValuation = {
  manualAssetValuationKey: 300,
  date: "2026-11-12",
  value: 1_200,
  note: null,
};

/** Two addresses: Bitcoin read, Ethereum failing, with a token not counted and one without a price. */
function twoAddressWallet() {
  const base = cryptoWallet();
  return cryptoWallet({
    unpricedSymbols: ["XYZ"],
    addresses: [
      base.addresses[0],
      {
        cryptoWalletAddressKey: 12,
        chain: "ethereum",
        kind: "address",
        address: "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed",
        label: null,
        status: "failed",
        errorCode: "rate_limited",
        lastAttemptAt: "2026-11-12T04:31:00.000Z",
        lastSyncedAt: null,
        tokens: [
          {
            cryptoWalletTokenKey: 22,
            native: true,
            contractAddress: null,
            symbol: "ETH",
            name: "Ether",
            quantity: "0.5",
            tracked: true,
            priceMissing: false,
          },
          {
            cryptoWalletTokenKey: 23,
            native: false,
            contractAddress: "0x0000000000000000000000000000000000000001",
            symbol: "USDC",
            name: "USD Coin",
            quantity: "250",
            tracked: false,
            priceMissing: false,
          },
          {
            cryptoWalletTokenKey: 24,
            native: false,
            contractAddress: "0x0000000000000000000000000000000000000002",
            symbol: "XYZ",
            name: null,
            quantity: "10",
            tracked: true,
            priceMissing: true,
          },
        ],
      },
    ],
  });
}

test("a wallet's value comes from its balances: no value is recorded or edited by hand", () => {
  renderDetail({}, [walletValuation], twoAddressWallet());

  screen.getByRole("heading", { name: "Hardware wallet" });
  screen.getAllByText(m.kinds.crypto_wallet);
  assert.equal(
    screen.queryByRole("button", { name: m.actions.updateValue }),
    null,
  );
  assert.equal(
    screen.queryByRole("button", { name: m.detail.valuations.edit }),
    null,
  );
  assert.equal(screen.queryByTestId("valuation-drawer"), null);
  screen.getByRole("button", { name: w.actions.syncNow });
  // Renaming, privacy and removal go through the usual flows.
  screen.getByRole("button", { name: m.actions.edit });
  screen.getByRole("button", { name: m.actions.delete });
});

test("each address shows its network, kind, short address, and how its last read went", () => {
  renderDetail({}, [walletValuation], twoAddressWallet());

  const cold = screen.getByRole("listitem", { name: "Cold storage" });
  // The network as a badge; the coin's own name is in its balance row.
  within(cold).getByText(w.chains.bitcoin, { selector: "div" });
  within(cold).getByText(w.addressKinds.address);
  within(cold).getByText("bc1qar0srr…wf5mdq");
  within(cold).getByText(/^Balances read on /);
  within(cold).getByText("BTC");
  within(cold).getByText("0.01234567");

  const eth = screen.getByRole("listitem", { name: w.chains.ethereum });
  within(eth).getByText(
    "The last read failed: the explorer asked to slow down.",
  );
  // A ticked token with no price is flagged, and today's value said not to have moved.
  within(eth).getByText(w.tokens.noPrice);
  screen.getByText(
    "Today's value was not updated: there is no price for XYZ. Untick them to count the rest.",
  );
  screen.getByText(w.detail.howItWorks);
});

test("a new address waits for its first read", () => {
  const base = cryptoWallet();
  renderDetail(
    { value: null, valueInUserCurrency: null, lastValuation: null },
    [],
    cryptoWallet({
      lastSyncedAt: null,
      addresses: [
        {
          ...base.addresses[0],
          status: "pending",
          lastSyncedAt: null,
          lastAttemptAt: null,
          tokens: [],
        },
      ],
    }),
  );

  screen.getByText(w.status.pending);
  screen.getByText(w.tokens.none);
  screen.getByText(w.detail.noValueYet);
});

test("ticking a token counts it, and unticking ignores it", async () => {
  state.track.mockResolvedValue(twoAddressWallet());
  const user = userEvent.setup();
  renderDetail({}, [walletValuation], twoAddressWallet());

  const usdc = screen.getByRole("checkbox", {
    name: "Count USDC in the value",
  });
  assert.equal(usdc.getAttribute("aria-checked"), "false");
  await user.click(usdc);
  await waitFor(() =>
    assert.deepEqual(state.track.mock.calls, [
      [{ manualAssetId: 1, tokenId: 23, tracked: true }],
    ]),
  );

  await user.click(
    screen.getByRole("checkbox", { name: "Count BTC in the value" }),
  );
  await waitFor(() =>
    assert.deepEqual(state.track.mock.calls[1], [
      { manualAssetId: 1, tokenId: 21, tracked: false },
    ]),
  );
});

test("Sync now asks for a fresh read", async () => {
  state.sync.mockResolvedValue(undefined);
  const user = userEvent.setup();
  renderDetail({}, [walletValuation], cryptoWallet());

  await user.click(screen.getByRole("button", { name: w.actions.syncNow }));
  await waitFor(() => assert.deepEqual(state.sync.mock.calls, [[1]]));
  assert.deepEqual(state.toastSuccess.mock.calls, [[w.syncQueued]]);
});

test("an address is removed after confirming, and the only one cannot be", async () => {
  state.removeAddress.mockResolvedValue(cryptoWallet());
  const user = userEvent.setup();
  renderDetail({}, [walletValuation], twoAddressWallet());

  await user.click(screen.getByRole("button", { name: "Remove Cold storage" }));
  within(screen.getByRole("alertdialog")).getByText(w.removeAddressConfirm);
  await user.click(
    within(screen.getByRole("alertdialog")).getByRole("button", {
      name: w.actions.removeAddress,
    }),
  );
  await waitFor(() =>
    assert.deepEqual(state.removeAddress.mock.calls, [
      [{ manualAssetId: 1, addressId: 11 }],
    ]),
  );
  cleanup();

  renderDetail({}, [walletValuation], cryptoWallet());
  assert.equal(
    screen.queryByRole("button", { name: /^Remove Cold storage/ }),
    null,
  );
});

test("an address's label can be changed or cleared", async () => {
  state.updateLabel.mockResolvedValue(cryptoWallet());
  const user = userEvent.setup();
  renderDetail({}, [walletValuation], cryptoWallet());

  await user.click(
    screen.getByRole("button", { name: "Edit the label of Cold storage" }),
  );
  const label = screen.getByLabelText(w.fields.label);
  await user.clear(label);
  await user.click(screen.getByRole("button", { name: m.actions.save }));
  await waitFor(() =>
    assert.deepEqual(state.updateLabel.mock.calls, [
      [{ manualAssetId: 1, addressId: 11, label: null }],
    ]),
  );
});

test("adding an address refuses a recovery phrase before sending it", async () => {
  const seed =
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
  const user = userEvent.setup();
  renderDetail({}, [walletValuation], cryptoWallet());

  await user.click(screen.getByRole("button", { name: w.actions.addAddress }));
  const dialog = screen.getByRole("dialog");
  within(dialog).getByText(w.publicOnly.title);
  const input = within(dialog).getByLabelText(
    new RegExp(w.fields.addressOrXpub),
  ) as HTMLInputElement;
  await user.click(input);
  await user.paste(seed);
  await user.click(
    within(dialog).getByRole("button", { name: w.actions.addAddress }),
  );

  await within(dialog).findByText(w.errors.secretBlocked);
  assert.equal(input.value, "");
  assert.equal(state.addAddress.mock.calls.length, 0);
  assert.equal(document.body.innerHTML.includes(seed), false);
});

test("adding an address sends its network, address and label", async () => {
  state.addAddress.mockResolvedValue(twoAddressWallet());
  const user = userEvent.setup();
  renderDetail({}, [walletValuation], cryptoWallet());

  await user.click(screen.getByRole("button", { name: w.actions.addAddress }));
  const dialog = screen.getByRole("dialog");
  await user.click(within(dialog).getByRole("combobox"));
  await user.click(
    await screen.findByRole("option", { name: w.chains.ethereum }),
  );
  await user.type(
    within(dialog).getByLabelText(new RegExp(`^${w.fields.address}`)),
    "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed",
  );
  await user.click(
    within(dialog).getByRole("button", { name: w.actions.addAddress }),
  );
  await waitFor(() =>
    assert.deepEqual(state.addAddress.mock.calls, [
      [
        {
          manualAssetId: 1,
          payload: {
            chain: "ethereum",
            address: "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed",
            label: null,
          },
        },
      ],
    ]),
  );
});
