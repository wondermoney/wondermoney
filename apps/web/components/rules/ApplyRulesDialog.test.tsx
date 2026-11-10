// @vitest-environment jsdom
import assert from "node:assert/strict";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, test, vi } from "vitest";

import enCommon from "../../messages/en/common.json";
import enRules from "../../messages/en/rules.json";
import { ApplyRulesDialog } from "./ApplyRulesDialog";

const state = vi.hoisted(() => ({
  count: 0,
  apply: vi.fn(),
  operation: null as null | {
    status: string;
    progress: Record<string, unknown> | null;
  },
  toastSuccess: vi.fn(),
}));

vi.mock("@/lib/api/rule/useRules", async (importOriginal) => {
  const actual = await importOriginal<object>();
  const { useQuery } = await import("@tanstack/react-query");
  return {
    ...actual,
    useRuleApplicationCount: () =>
      useQuery({ queryKey: ["count"], queryFn: () => state.count }),
    useApplyRules: () => ({ mutateAsync: state.apply, isPending: false }),
  };
});

vi.mock("@/lib/api/background-operation/useBackgroundOperation", async () => {
  const { useQuery } = await import("@tanstack/react-query");
  // Polls the test's state, as the real hook polls the API.
  return {
    useBackgroundOperation: (id?: string) =>
      useQuery({
        queryKey: ["operation", id],
        queryFn: () => state.operation,
        enabled: !!id,
        refetchInterval: 20,
      }),
  };
});

vi.mock("sonner", () => ({
  toast: { success: state.toastSuccess, error: vi.fn(), info: vi.fn() },
}));

afterEach(() => {
  cleanup();
  state.apply.mockReset();
  state.toastSuccess.mockReset();
  state.operation = null;
});

function renderDialog(offer: boolean) {
  const onClose = vi.fn();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <NextIntlClientProvider
        locale="en"
        messages={{ ...enCommon, ...enRules }}
        timeZone="UTC"
      >
        <ApplyRulesDialog
          target={{ ruleKey: 7 }}
          ruleName="Netflix"
          offer={offer}
          onClose={onClose}
        />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  return { onClose };
}

test("after saving, offers nothing when no existing transaction would change", async () => {
  state.count = 0;
  const { onClose } = renderDialog(true);

  await waitFor(() => assert.equal(onClose.mock.calls.length, 1));
  assert.equal(screen.queryByRole("alertdialog"), null);
});

test("shows the count, applies on confirmation, follows the run and reports how many changed", async () => {
  state.count = 3;
  state.apply.mockResolvedValue("rule.apply:1");
  const { onClose } = renderDialog(true);

  await screen.findByText("3 existing transactions would change.");
  await userEvent.click(
    screen.getByRole("button", { name: "Apply to 3 transactions" }),
  );
  assert.deepEqual(state.apply.mock.calls[0], [{ ruleKey: 7 }]);

  state.operation = {
    status: "running",
    progress: { changed: 1, processed: 1, total: 2, cursor: 1, ruleKey: 7 },
  };
  await screen.findByText("1 of 2 transactions checked");

  state.operation = {
    status: "succeeded",
    progress: { changed: 3, processed: 2, total: 2, cursor: 2, ruleKey: 7 },
  };
  await waitFor(() => assert.equal(onClose.mock.calls.length, 1));
  assert.deepEqual(state.toastSuccess.mock.calls[0], [
    "Done: 3 transactions changed",
  ]);
});
