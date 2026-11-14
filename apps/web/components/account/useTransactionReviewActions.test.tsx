// @vitest-environment jsdom
import assert from "node:assert/strict";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, test, vi } from "vitest";

import type { Transaction } from "@/lib/api/account/useTransactions";

import enCategories from "../../messages/en/categories.json";
import enCommon from "../../messages/en/common.json";
import enRules from "../../messages/en/rules.json";
import enTransactions from "../../messages/en/transactions.json";
import { useTransactionReviewActions } from "./useTransactionReviewActions";

const state = vi.hoisted(() => ({
  edit: vi.fn(),
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

vi.mock("@/lib/api/account/useEditTransactions", () => ({
  default: () => ({ mutateAsync: state.edit }),
}));
vi.mock("posthog-js/react", () => ({
  usePostHog: () => ({ capture: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: state.toast }));

afterEach(() => {
  state.edit.mockReset();
  state.toast.mockReset();
  state.toast.success.mockReset();
});

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <NextIntlClientProvider
        locale="en"
        messages={{
          ...enCommon,
          ...enCategories,
          ...enRules,
          ...enTransactions,
        }}
        timeZone="UTC"
      >
        {children}
      </NextIntlClientProvider>
    </QueryClientProvider>
  );
}

const rows = [11, 12].map(
  (transactionKey) => ({ transactionKey }) as unknown as Transaction,
);

test("categorizing from the review inbox offers the rule the update suggests", async () => {
  state.edit.mockResolvedValue({
    data: {
      ruleSuggestion: {
        category: { categoryKey: 5, name: "Family" },
        fingerprint: "b".repeat(64),
        kind: "merchant",
        matchCount: 4,
        rule: {
          name: "Lidl",
          match: "all",
          stopProcessing: false,
          conditions: [
            { field: "merchant", operator: "equals", value: "Lidl" },
          ],
          actions: [{ type: "set_category", categoryId: 5 }],
        },
        windowDays: 90,
      },
    },
  });
  const { result } = renderHook(() => useTransactionReviewActions(), {
    wrapper,
  });

  await act(() => result.current.categorizeTransactions(rows, "5"));

  assert.equal(state.toast.success.mock.calls.length, 1);
  assert.equal(state.toast.mock.calls.length, 1);
  assert.match(String(state.toast.mock.calls[0]?.[0]), /Family/);
});

test("categorizing without a suggestion only confirms the change", async () => {
  state.edit.mockResolvedValue({ data: { ruleSuggestion: null } });
  const { result } = renderHook(() => useTransactionReviewActions(), {
    wrapper,
  });

  await act(() => result.current.categorizeTransactions(rows, "5"));

  assert.equal(state.toast.success.mock.calls.length, 1);
  assert.equal(state.toast.mock.calls.length, 0);
});
