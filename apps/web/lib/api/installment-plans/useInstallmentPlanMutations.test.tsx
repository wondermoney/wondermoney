// @vitest-environment jsdom
import assert from "node:assert/strict";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, test, vi } from "vitest";

import type { InstallmentPlanDetail } from "./types";
import {
  installmentLinkError,
  useLinkInstallment,
  useUnlinkInstallment,
} from "./useInstallmentPlanMutations";
import { installmentPlanKeys } from "./useInstallmentPlans";

const server = vi.hoisted(() => ({
  post: vi.fn(),
  delete: vi.fn(),
}));

vi.mock("@/lib/api/api", () => ({
  default: { post: server.post, delete: server.delete },
}));

afterEach(() => {
  cleanup();
  server.post.mockReset();
  server.delete.mockReset();
});

const plan = { installmentPlanKey: 9 } as InstallmentPlanDetail;

const refusal = (status: number, code: string) =>
  Object.assign(new Error(code), { response: { status, data: { code } } });

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidated: unknown[][] = [];
  const invalidate = queryClient.invalidateQueries.bind(queryClient);
  queryClient.invalidateQueries = ((filters?: { queryKey?: unknown[] }) => {
    invalidated.push(filters?.queryKey ?? []);
    return invalidate(filters);
  }) as typeof queryClient.invalidateQueries;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, invalidated, wrapper };
}

const refreshed = (invalidated: unknown[][]) =>
  [
    "installment-plans",
    "transactions",
    "accounts-transactions",
    "accounts-transactions-infinite",
  ].every((root) => invalidated.some((key) => key[0] === root));

describe("installment link mutations", () => {
  test("a link posts the transaction to the installment and refreshes the plan, the commitments and the lists", async () => {
    server.post.mockResolvedValue({ data: { installmentPlan: plan } });
    const { queryClient, invalidated, wrapper } = setup();
    const { result } = renderHook(() => useLinkInstallment(), { wrapper });

    await act(() =>
      result.current.mutateAsync({
        installmentPlanKey: 9,
        installmentNumber: 2,
        transactionKey: 77,
      }),
    );

    assert.deepEqual(server.post.mock.calls, [
      ["/v1/installment-plans/9/installments/2/link", { transactionKey: 77 }],
    ]);
    assert.deepEqual(queryClient.getQueryData(installmentPlanKeys.detail(9)), {
      installmentPlan: plan,
    });
    assert.ok(refreshed(invalidated));
  });

  test("an unlink deletes the installment's link and refreshes too", async () => {
    server.delete.mockResolvedValue({ data: { installmentPlan: plan } });
    const { invalidated, wrapper } = setup();
    const { result } = renderHook(() => useUnlinkInstallment(), { wrapper });

    await act(() =>
      result.current.mutateAsync({
        installmentPlanKey: 9,
        installmentNumber: 1,
      }),
    );

    assert.deepEqual(server.delete.mock.calls, [
      ["/v1/installment-plans/9/installments/1/link"],
    ]);
    assert.ok(refreshed(invalidated));
  });

  test("a conflict means the page is out of date, so it refreshes; a wrong card does not", async () => {
    const { invalidated, wrapper } = setup();
    const { result } = renderHook(() => useLinkInstallment(), { wrapper });

    server.post.mockRejectedValueOnce(refusal(400, "bad_request"));
    await act(() =>
      result.current
        .mutateAsync({
          installmentPlanKey: 9,
          installmentNumber: 2,
          transactionKey: 5,
        })
        .catch(() => undefined),
    );
    assert.equal(invalidated.length, 0);

    // A pending charge is not a stale page: nothing to refetch.
    server.post.mockRejectedValueOnce(refusal(400, "transaction_pending"));
    await act(() =>
      result.current
        .mutateAsync({
          installmentPlanKey: 9,
          installmentNumber: 2,
          transactionKey: 5,
        })
        .catch(() => undefined),
    );
    assert.equal(invalidated.length, 0);

    server.post.mockRejectedValueOnce(refusal(409, "installment_already_paid"));
    await act(() =>
      result.current
        .mutateAsync({
          installmentPlanKey: 9,
          installmentNumber: 2,
          transactionKey: 5,
        })
        .catch(() => undefined),
    );
    assert.ok(refreshed(invalidated));
    invalidated.length = 0;

    server.post.mockRejectedValueOnce(refusal(409, "conflict"));
    await act(() =>
      result.current
        .mutateAsync({
          installmentPlanKey: 9,
          installmentNumber: 2,
          transactionKey: 5,
        })
        .catch(() => undefined),
    );
    assert.ok(refreshed(invalidated));
  });
});

test("installmentLinkError names each refusal of the link endpoint", () => {
  assert.equal(
    installmentLinkError(refusal(400, "transaction_pending")),
    "pending",
  );
  assert.equal(
    installmentLinkError(refusal(400, "transaction_expired")),
    "expired",
  );
  assert.equal(
    installmentLinkError(refusal(409, "transaction_already_linked")),
    "transaction-linked",
  );
  assert.equal(
    installmentLinkError(refusal(409, "installment_already_paid")),
    "installment-paid",
  );
  assert.equal(installmentLinkError(refusal(400, "bad_request")), "wrong-card");
  assert.equal(installmentLinkError(refusal(404, "not_found")), "not-found");
  assert.equal(installmentLinkError(refusal(403, "demo_read_only")), "demo");
  assert.equal(
    installmentLinkError(refusal(400, "validation_failed")),
    "failed",
  );
  assert.equal(installmentLinkError(new Error("offline")), "failed");
});

test("installmentLinkError falls back to the status for an API without the specific codes", () => {
  assert.equal(installmentLinkError(refusal(400, "bad_request")), "wrong-card");
  assert.equal(
    installmentLinkError(refusal(409, "conflict")),
    "already-linked",
  );
});
