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
  GetManualAssetResponse,
  ManualAssetValuation,
} from "@/lib/api/manual-asset/types";
import { figure, manualAsset } from "@/lib/manual-assets/asset-fixture";

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
}));

vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
  useRouter: () => ({ push: state.push }),
}));
vi.mock("sonner", () => ({ toast: { error: state.toastError } }));
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
) {
  const asset = manualAsset({ lastValuation: valuations[0], ...overrides });
  state.data = {
    asset,
    valuations,
    history: [...valuations]
      .reverse()
      .map(({ date, value }) => ({ date, value })),
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
