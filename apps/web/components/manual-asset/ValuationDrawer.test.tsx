// @vitest-environment jsdom
import assert from "node:assert/strict";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, test, vi } from "vitest";

import type { ManualAssetValuation } from "@/lib/api/manual-asset/types";
import { dayString } from "@/lib/manual-assets/asset-view";

import enAssets from "../../messages/en/assets.json";
import enCommon from "../../messages/en/common.json";
import enNavigation from "../../messages/en/navigation.json";
import ValuationDrawer from "./ValuationDrawer";

const state = vi.hoisted(() => ({
  save: vi.fn(),
  onOpenChange: vi.fn(),
}));

vi.mock("@/lib/api/manual-asset/useManualAssetMutations", () => ({
  useSaveValuation: () => ({ mutateAsync: state.save, isPending: false }),
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
  state.save.mockReset();
  state.onOpenChange.mockReset();
});

const m = enAssets.assets;

function renderDrawer(valuation?: ManualAssetValuation) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <NextIntlClientProvider
        locale="en"
        messages={{ ...enCommon, ...enNavigation, ...enAssets }}
      >
        <ValuationDrawer
          open
          onOpenChange={state.onOpenChange}
          asset={{ currency: "EUR", manualAssetKey: 5, value: 250_000 }}
          valuation={valuation}
        />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

test("Update value records today's value, starting from the current one, and says it is no transaction", async () => {
  state.save.mockResolvedValue({});
  const user = userEvent.setup();
  renderDrawer();

  screen.getByText(m.valuation.description);
  const value = screen.getByLabelText(new RegExp(m.valuation.value));
  assert.equal((value as HTMLInputElement).value, "250000");
  await user.clear(value);
  await user.type(value, "265000");
  await user.type(screen.getByLabelText(m.valuation.note), "  Agent estimate ");
  await user.click(screen.getByRole("button", { name: m.valuation.save }));

  await waitFor(() => assert.equal(state.save.mock.calls.length, 1));
  assert.deepEqual(state.save.mock.calls[0][0], {
    manualAssetId: 5,
    valuationId: undefined,
    payload: {
      value: 265_000,
      date: dayString(new Date()),
      note: "Agent estimate",
    },
  });
  assert.deepEqual(state.onOpenChange.mock.calls, [[false]]);
});

test("editing a valuation corrects that one, on its own date", async () => {
  state.save.mockResolvedValue({});
  const user = userEvent.setup();
  renderDrawer({
    manualAssetValuationKey: 42,
    date: "2025-01-10",
    value: 200_000,
    note: "Purchase",
  });

  screen.getByRole("heading", { name: m.valuation.editTitle });
  const value = screen.getByLabelText(new RegExp(m.valuation.value));
  await user.clear(value);
  await user.type(value, "199500");
  await user.click(screen.getByRole("button", { name: m.valuation.save }));

  await waitFor(() => assert.equal(state.save.mock.calls.length, 1));
  assert.deepEqual(state.save.mock.calls[0][0], {
    manualAssetId: 5,
    valuationId: 42,
    payload: { value: 199_500, date: "2025-01-10", note: "Purchase" },
  });
});

test("a negative value is refused before asking the API", async () => {
  const user = userEvent.setup();
  renderDrawer();

  const value = screen.getByLabelText(new RegExp(m.valuation.value));
  await user.clear(value);
  await user.type(value, "-1");
  await user.click(screen.getByRole("button", { name: m.valuation.save }));

  await screen.findByText(m.validation.negative);
  assert.equal(state.save.mock.calls.length, 0);
});
