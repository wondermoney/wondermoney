// @vitest-environment jsdom
import assert from "node:assert/strict";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { useEffect } from "react";
import { afterEach, beforeAll, test, vi } from "vitest";

import type { RuleDraft } from "@/lib/api/rule/useRules";
import { useRuleSuggestionEditor } from "@/lib/rules/rule-suggestion-editor";

import enCategories from "../../messages/en/categories.json";
import enCommon from "../../messages/en/common.json";
import enRules from "../../messages/en/rules.json";
import { RuleSuggestionEditorHost } from "./RuleSuggestionEditorHost";
import { useRuleSuggestionPrompt } from "./useRuleSuggestionPrompt";

interface ToastOptions {
  description?: string;
  action: { label: string; onClick: () => void };
  cancel: { label: string; onClick: () => void };
}

const state = vi.hoisted(() => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
  post: vi.fn(),
  previewed: [] as unknown[],
}));

vi.mock("sonner", () => ({ toast: state.toast }));
vi.mock("@/lib/api/api", () => ({ default: { post: state.post } }));

// The editor's pickers and lookups read cached queries other screens load; empty lists are enough here.
vi.mock("@/components/CategorySelect", () => ({ default: () => null }));
vi.mock("@/lib/api/account/useAccounts", () => ({
  default: () => ({ data: { accounts: [] } }),
}));
vi.mock("@/lib/api/category/useCategories", () => ({
  default: () => ({ data: { categories: [] } }),
}));
vi.mock("@/lib/api/configs/useConfigs", () => ({
  default: () => ({ data: { transactionTypes: [], currencies: [] } }),
}));
vi.mock("@/lib/api/tag/useTags", () => ({
  default: () => ({ data: { tags: [] } }),
}));
vi.mock("@/lib/api/account/useTransactionMerchants", () => ({
  default: () => ({ data: { transactionMerchants: [] } }),
}));
vi.mock("@/lib/api/rule/useRules", async (importOriginal) => {
  const actual = await importOriginal<object>();
  return {
    ...actual,
    // What the editor asks to preview, answered with one match.
    useRulePreview: (draft: RuleDraft | null) => {
      if (draft) state.previewed.push(draft);
      return {
        data: draft
          ? { matchCount: 3, changeCount: 1, transactions: [] }
          : undefined,
        isError: false,
        isFetching: false,
      };
    },
  };
});

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

afterEach(() => {
  cleanup();
  state.toast.mockReset();
  state.post.mockReset();
  state.previewed = [];
  useRuleSuggestionEditor.getState().close();
});

const suggestion = {
  category: { categoryKey: 5, name: "GROCERIES" },
  fingerprint: "a".repeat(64),
  kind: "description",
  matchCount: 3,
  rule: {
    name: "TRF MB WAY",
    match: "all",
    stopProcessing: false,
    conditions: [
      {
        field: "description",
        operator: "starts_with",
        source: "cleaned",
        value: "TRF MB WAY",
      },
    ],
    actions: [{ type: "set_category", categoryId: 5 }],
  },
  windowDays: 90,
};

let prompt: (body: unknown) => void = () => {};

function Harness({
  onPrompt,
}: {
  onPrompt: (show: (body: unknown) => void) => void;
}) {
  const show = useRuleSuggestionPrompt();
  useEffect(() => onPrompt(show), [onPrompt, show]);
  return <RuleSuggestionEditorHost />;
}

function renderHarness() {
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <NextIntlClientProvider
        locale="en"
        messages={{ ...enCommon, ...enCategories, ...enRules }}
        timeZone="UTC"
      >
        <Harness
          onPrompt={(show) => {
            prompt = show;
          }}
        />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

function shownPrompt(): { title: string; options: ToastOptions } {
  assert.equal(state.toast.mock.calls.length, 1);
  const [title, options] = state.toast.mock.calls[0] as [string, ToastOptions];
  return { title, options };
}

test("asks to always categorize transactions like these as the suggested category, by its translated name", () => {
  renderHarness();

  act(() => prompt({ ruleSuggestion: suggestion }));

  const { title, options } = shownPrompt();
  assert.match(title, /Groceries/);
  assert.match(options.description ?? "", /3/);
  assert.equal(options.action.label, "Create rule");
});

test("shows nothing for an update with no suggestion, or an empty body", () => {
  renderHarness();

  act(() => {
    prompt({ ruleSuggestion: null });
    prompt(undefined);
    prompt({ transaction: { transactionKey: 1 } });
  });

  assert.equal(state.toast.mock.calls.length, 0);
});

test("Create rule opens the editor filled in with the suggested rule, and previews it", async () => {
  renderHarness();
  act(() => prompt({ ruleSuggestion: suggestion }));

  act(() => shownPrompt().options.action.onClick());

  await screen.findByRole("dialog");
  assert.equal(
    (screen.getByLabelText("Name") as HTMLInputElement).value,
    "TRF MB WAY",
  );
  assert.equal(
    (screen.getByLabelText("Value for condition 1") as HTMLInputElement).value,
    "TRF MB WAY",
  );
  await waitFor(() =>
    assert.deepEqual(state.previewed.at(-1), {
      match: "all",
      conditions: [
        {
          field: "description",
          operator: "starts_with",
          source: "cleaned",
          value: "TRF MB WAY",
        },
      ],
      actions: [{ type: "set_category", categoryId: 5 }],
    }),
  );
});

test("Don't suggest again dismisses the suggestion by its fingerprint", async () => {
  state.post.mockResolvedValue({ status: 204 });
  renderHarness();
  act(() => prompt({ ruleSuggestion: suggestion }));

  act(() => shownPrompt().options.cancel.onClick());

  await waitFor(() =>
    assert.deepEqual(state.post.mock.calls[0], [
      "/v1/rule/suggestions/dismiss",
      { fingerprint: suggestion.fingerprint },
    ]),
  );
  assert.equal(screen.queryByRole("dialog"), null);
});
