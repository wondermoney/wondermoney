// @vitest-environment jsdom
import assert from "node:assert/strict";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, test, vi } from "vitest";

import useAccounts, { type GetAccountsResponse } from "../useAccounts";
import useCreateOfflineAccount from "../useCreateOfflineAccount";

// A tiny in-memory API: the accounts list is whatever has been created.
const server = vi.hoisted(() => ({
  accounts: [] as Record<string, unknown>[],
  accountListRequests: 0,
}));

vi.mock("@/lib/api/api", () => ({
  default: {
    get: async (url: string) => {
      if (url !== "/v1/account") throw new Error(`unexpected GET ${url}`);
      server.accountListRequests += 1;
      return { data: { accounts: server.accounts } };
    },
    post: async (
      url: string,
      body: { name: string; currentBalance: number; accountTypeId?: number },
    ) => {
      if (url !== "/v1/account/offline") throw new Error(`unexpected POST ${url}`);
      server.accounts.push({
        accountKey: server.accounts.length + 1,
        accountName: body.name,
        balance: body.currentBalance,
        accountTypeId: body.accountTypeId,
        currencyKey: { code: "EUR" },
        accountOwnerAppuserKey: { currencyKey: { code: "EUR" } },
      });
      return { data: {}, status: 201 };
    },
  },
}));

afterEach(() => {
  cleanup();
  server.accounts = [];
  server.accountListRequests = 0;
});

function appQueryClient() {
  // The app's default: a minute of freshness, so a cached list is trusted.
  return new QueryClient({
    defaultOptions: { queries: { staleTime: 60_000, retry: false } },
  });
}

function wrapperFor(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

const accountNames = (data: GetAccountsResponse | undefined) =>
  data?.accounts.map((account) => account.accountName) ?? [];

test("the dashboard after onboarding shows the manual account created in the wizard", async () => {
  const queryClient = appQueryClient();
  const wrapper = wrapperFor(queryClient);

  // A new user lands on the app shell, whose first-run gate reads the account
  // list (empty) before redirecting into onboarding, and then unmounts.
  const gate = renderHook(() => useAccounts(), { wrapper });
  await waitFor(() => assert.equal(gate.result.current.isSuccess, true));
  assert.deepEqual(accountNames(gate.result.current.data), []);
  gate.unmount();

  // The Connect step adds a manual account and navigates on from its
  // per-call onSuccess, exactly as FirstRunAccountStep does.
  const { result } = renderHook(() => useCreateOfflineAccount(), { wrapper });
  let cachedWhenNavigating: (string | null)[] = [];
  await act(() =>
    result.current.mutateAsync(
      { name: "Smoke Checking", currentBalance: 1000, currencyId: "151" },
      {
        onSuccess: () => {
          cachedWhenNavigating = accountNames(
            queryClient.getQueryData<GetAccountsResponse>(["accounts"]),
          );
        },
      },
    ),
  );
  assert.deepEqual(cachedWhenNavigating, ["Smoke Checking"]);

  // The dashboard mounts well inside the staleTime window, with the server's
  // render passed as initialData (which React Query ignores once the key is
  // cached). Its very first render must already include the account.
  const requestsBeforeDashboard = server.accountListRequests;
  const dashboard = renderHook(
    () => useAccounts({ initialData: { accounts: [] } }),
    { wrapper },
  );
  assert.deepEqual(accountNames(dashboard.result.current.data), [
    "Smoke Checking",
  ]);
  assert.equal(server.accountListRequests, requestsBeforeDashboard);
});

test("creating a manual account refreshes an account list that is on screen", async () => {
  const queryClient = appQueryClient();
  const wrapper = wrapperFor(queryClient);

  // Read `data` during render: React Query re-renders only for the result
  // properties a component actually reads.
  const list = renderHook(() => accountNames(useAccounts().data), { wrapper });
  await waitFor(() => assert.deepEqual(list.result.current, []));

  const { result } = renderHook(() => useCreateOfflineAccount(), { wrapper });
  await act(() =>
    result.current.mutateAsync({
      name: "Savings",
      currentBalance: 50,
      currencyId: "151",
    }),
  );

  await waitFor(() =>
    assert.deepEqual(list.result.current, ["Savings"]),
  );
});

test("a manual account keeps the type the user picked, and a typeless one stays untyped", async () => {
  const queryClient = appQueryClient();
  const { result } = renderHook(() => useCreateOfflineAccount(), {
    wrapper: wrapperFor(queryClient),
  });

  await act(() =>
    result.current.mutateAsync({
      name: "Card",
      currentBalance: -200,
      currencyId: "151",
      accountTypeId: 5,
    }),
  );
  await act(() =>
    result.current.mutateAsync({ name: "Cash", currentBalance: 20, currencyId: "151" }),
  );

  assert.deepEqual(
    server.accounts.map(({ accountName, accountTypeId }) => [accountName, accountTypeId]),
    [
      ["Card", 5],
      ["Cash", undefined],
    ],
  );
});
