// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, test, vi } from "vitest";

import enAssets from "../../messages/en/assets.json";
import enCommon from "../../messages/en/common.json";
import esAssets from "../../messages/es/assets.json";
import esCommon from "../../messages/es/common.json";
import ptAssets from "../../messages/pt/assets.json";
import ptCommon from "../../messages/pt/common.json";
import { ManualAssetImportFlow } from "./ManualAssetImportFlow";

const state = vi.hoisted(() => ({ importAssets: vi.fn(), isPending: false }));

vi.mock("@/lib/api/manual-asset/useManualAssetMutations", () => ({
  useImportManualAssets: () => ({ isPending: state.isPending, mutateAsync: state.importAssets }),
}));

beforeAll(() => {
  // jsdom's File has no text(); browsers do.
  File.prototype.text ??= function (this: File) {
    return new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsText(this);
    });
  };
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

afterEach(() => {
  cleanup();
  state.importAssets.mockReset();
});

const m = enAssets.assets.import;

function renderFlow(onClose = vi.fn(), messages: Record<string, unknown> = { ...enCommon, ...enAssets }, locale = "en") {
  render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      <ManualAssetImportFlow onClose={onClose} />
    </NextIntlClientProvider>,
  );
}

async function upload(csv: string) {
  const user = userEvent.setup();
  const input = document.querySelector('input[type="file"]');
  assert.ok(input instanceof HTMLInputElement);
  await user.upload(input, new File([csv], "assets.csv", { type: "text/csv" }));
  return user;
}

test("previews a filled-in template and creates its assets with their valuations", async () => {
  state.importAssets.mockResolvedValue([{ manualAssetKey: 1, name: "Flat" }, { manualAssetKey: 2, name: "Watch" }]);
  renderFlow();
  const user = await upload("Name,Kind,Value,Valuation date,Currency,Private\nFlat,property,250000,2025-06-30,EUR,no\nWatch,valuable,4000,,EUR,yes");

  await screen.findByRole("table");
  screen.getByText("Flat");
  screen.getByText("Watch");
  await user.click(screen.getByRole("button", { name: "Import 2 assets" }));

  await screen.findByText(m["done-title"]);
  assert.deepEqual(state.importAssets.mock.calls[0][0], [
    { currencyCode: "EUR", isPrivate: false, kind: "property", name: "Flat", value: 250000, valuationDate: "2025-06-30" },
    { currencyCode: "EUR", isPrivate: true, kind: "valuable", name: "Watch", value: 4000 },
  ]);
  screen.getByText("2 assets were added with their valuations.");
});

test("lists the rows that need fixing and creates nothing", async () => {
  renderFlow();
  await upload("Name,Kind,Value,Currency\nFlat,property,250000,EUR\nBoat,yacht,10,EUR");

  await screen.findByText("1 row needs fixing");
  screen.getByText("Line 3: kind");
  assert.equal(screen.queryByRole("table"), null);
  assert.equal(screen.getByRole("button", { name: "Import 1 asset" }).hasAttribute("disabled"), true);
  assert.equal(state.importAssets.mock.calls.length, 0);
});

test("explains a file that is not a manual-assets file", async () => {
  renderFlow();
  await upload("Symbol,Quantity\nAAPL,3");

  await screen.findByText(m["file-problem-title"]);
  screen.getByText(m.issues["missing-columns"]);
});

test("says nothing was created when the import fails", async () => {
  state.importAssets.mockRejectedValue(new Error("400"));
  renderFlow();
  const user = await upload("Name,Kind,Value,Currency\nFlat,property,250000,EUR");

  await user.click(await screen.findByRole("button", { name: "Import 1 asset" }));

  await waitFor(() => screen.getByText(m.failed));
});

for (const { locale, messages } of [
  { locale: "pt", messages: { ...ptCommon, ...ptAssets } },
  { locale: "es", messages: { ...esCommon, ...esAssets } },
]) {
  test(`offers the template in ${locale}`, () => {
    renderFlow(vi.fn(), messages, locale);

    screen.getByRole("button", { name: messages.assets.import["download-template"] });
  });
}
