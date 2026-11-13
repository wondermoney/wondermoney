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
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, beforeEach, test, vi } from "vitest";

import type {
  RulePresetList,
  RulePresetPreview,
} from "@/lib/api/rule/useRulePresets";

import enCategories from "../../messages/en/categories.json";
import enCommon from "../../messages/en/common.json";
import enRulePresets from "../../messages/en/rule-presets.json";
import { RulePresetOffer, RulePresetsButton } from "./RulePresetOffer";

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("@/lib/api/api", () => ({ default: api }));

const t = enRulePresets.rulePresets;

const summary = (code: string, ruleCount: number, installedCount = 0) => ({
  code,
  countries: code === "pt-PT" ? ["PT"] : ["ES"],
  language: code.slice(0, 2),
  revision: 1,
  ruleCount,
  installedCount,
  installed: installedCount === ruleCount,
});

const condition = (value: string, operator = "contains") => ({
  field: "description",
  operator,
  source: "raw" as const,
  value,
});
const out = {
  field: "direction",
  operator: "is" as const,
  value: "out" as const,
};

const portugal: RulePresetPreview = {
  preset: summary("pt-PT", 3, 1),
  rules: [
    {
      name: "Continente",
      match: "all",
      conditions: [out, condition("Continente")],
      actions: [
        { type: "set_category", category: { system: "GROCERIES" } },
        { type: "set_merchant", merchant: "Continente" },
      ],
      status: "installed",
    },
    {
      name: "EDP Comercial",
      match: "all",
      conditions: [out, condition("EDP Comercial")],
      actions: [
        { type: "set_category", category: { system: "ELECTRICITY" } },
        { type: "set_merchant", merchant: "EDP" },
      ],
      status: "new",
    },
    {
      name: "Tesco",
      match: "all",
      conditions: [out, condition("Tesco"), condition("Bank", "not_contains")],
      actions: [{ type: "set_category", category: { system: "GROCERIES" } }],
      status: "new",
    },
  ],
};

let list: RulePresetList;

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
});

beforeEach(() => {
  window.localStorage.clear();
  list = {
    presets: [summary("pt-PT", 3), summary("es-ES", 2)],
    suggested: "pt-PT",
  };
  api.get.mockImplementation(async (url: string) => {
    if (url === "/v1/rule/presets") return { data: list };
    if (url === "/v1/rule/presets/pt-PT") return { data: portugal };
    throw new Error(`unexpected GET ${url}`);
  });
  api.post.mockResolvedValue({
    data: {
      created: ["EDP Comercial", "Tesco"],
      skipped: ["Continente"],
      preset: summary("pt-PT", 3, 3),
    },
  });
});

afterEach(() => {
  cleanup();
  api.get.mockReset();
  api.post.mockReset();
});

function renderWithProviders(node: React.ReactNode, locale = "pt") {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <NextIntlClientProvider
        locale={locale}
        messages={{ ...enCommon, ...enCategories, ...enRulePresets }}
      >
        {node}
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

const offerTitle = t.offer.title.replace("{name}", "Portugal");

test("offers the preset matching the person's language, and asks the API with it", async () => {
  renderWithProviders(<RulePresetOffer />);

  assert.ok(await screen.findByText(offerTitle));
  const [url, config] = api.get.mock.calls[0] as [
    string,
    { params: { language: string } },
  ];
  assert.equal(url, "/v1/rule/presets");
  assert.equal(config.params.language, "pt");
  // Offering is not installing.
  assert.equal(api.post.mock.calls.length, 0);
});

test("previews every rule with what it sets before anything is added", async () => {
  const user = userEvent.setup();
  renderWithProviders(<RulePresetOffer />);

  await user.click(
    await screen.findByRole("button", { name: t.offer.preview }),
  );

  const rules = await screen.findByRole("list", { name: "Rules for Portugal" });
  const items = within(rules).getAllByRole("listitem");
  assert.equal(items.length, 3);
  assert.ok(within(items[0]!).getByText(t.status.installed));
  assert.ok(within(items[1]!).getByText("Electricity"));
  assert.ok(within(items[1]!).getByText("Merchant: EDP"));
  assert.ok(
    within(items[2]!).getByText("Description contains “Tesco” but not “Bank”"),
  );
  assert.equal(api.post.mock.calls.length, 0);
});

test("adds only the new rules, and only when confirmed", async () => {
  const user = userEvent.setup();
  const onInstalled = vi.fn();
  renderWithProviders(<RulePresetOffer onInstalled={onInstalled} />);

  await user.click(
    await screen.findByRole("button", { name: t.offer.preview }),
  );
  await user.click(await screen.findByRole("button", { name: "Add 2 rules" }));

  await waitFor(() => assert.equal(onInstalled.mock.calls.length, 1));
  assert.deepEqual(api.post.mock.calls, [["/v1/rule/presets/pt-PT/install"]]);
});

test("offers nothing to add when every rule is already there", async () => {
  const user = userEvent.setup();
  portugal.rules.forEach((rule) => (rule.status = "installed"));
  renderWithProviders(<RulePresetsButton />);

  await user.click(await screen.findByRole("button", { name: t.browse }));

  assert.ok(await screen.findByText(t.dialog.nothing));
  const add = screen.getByRole("button", { name: "Nothing to add" });
  assert.equal((add as HTMLButtonElement).disabled, true);
  portugal.rules.forEach(
    (rule, index) => (rule.status = index === 0 ? "installed" : "new"),
  );
});

test("stays quiet once any of the preset is in the household's rules", async () => {
  list.presets = [summary("pt-PT", 3, 1)];
  renderWithProviders(<RulePresetOffer />);

  await waitFor(() => assert.equal(api.get.mock.calls.length, 1));
  assert.equal(screen.queryByText(offerTitle), null);
});

test("stays quiet when no preset matches the person", async () => {
  list.suggested = null;
  renderWithProviders(<RulePresetOffer />, "en");

  await waitFor(() => assert.equal(api.get.mock.calls.length, 1));
  assert.equal(screen.queryByRole("button", { name: t.offer.preview }), null);
});

test("remembers Not now in this browser", async () => {
  const user = userEvent.setup();
  renderWithProviders(<RulePresetOffer />);

  await user.click(
    await screen.findByRole("button", { name: t.offer.dismiss }),
  );
  assert.equal(screen.queryByText(offerTitle), null);

  cleanup();
  renderWithProviders(<RulePresetOffer />);
  await waitFor(() => assert.ok(api.get.mock.calls.length >= 2));
  assert.equal(screen.queryByText(offerTitle), null);
});
