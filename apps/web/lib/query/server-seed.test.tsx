// @vitest-environment jsdom
import assert from "node:assert/strict";

import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, test, vi } from "vitest";

import useAccount, {
  type GetAccountResponse,
} from "@/lib/api/account/useAccount";
import useAccounts, {
  type GetAccountsResponse,
} from "@/lib/api/account/useAccounts";
import {
  type GetTransactionsResponse,
  useInfiniteTransactions,
} from "@/lib/api/account/useTransactions";
import { getQueryClient } from "@/lib/query/query-client";
import { serverSeed } from "@/lib/query/server-seed";

// Every request the hooks make is counted; a seed that wins must make none.
const api = vi.hoisted(() => ({ requests: [] as string[] }));

vi.mock("@/lib/api/api", () => ({
  default: {
    get: async (url: string) => {
      api.requests.push(url);
      return { data: { accounts: [{ accountName: "From the client fetch" }] } };
    },
  },
}));

// The app's own client: the 60s staleTime and the server-seed rule both apply.
const queryClient = getQueryClient();

afterEach(() => {
  cleanup();
  queryClient.clear();
  api.requests = [];
});

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

const accountsResponse = (...names: string[]) =>
  ({
    accounts: names.map((accountName) => ({ accountName })),
  }) as unknown as GetAccountsResponse;
const names = (data: GetAccountsResponse | undefined) =>
  data?.accounts.map((account) => account.accountName) ?? [];

test("a cached account list is replaced by the newer list the server rendered", async () => {
  const now = Date.now();
  // An earlier page cached the list 30s ago: still fresh, so nothing would refetch it.
  queryClient.setQueryData(["accounts"], accountsResponse(), {
    updatedAt: now - 30_000,
  });

  // The dashboard's server render, 5s ago, already has the new account.
  const { result } = renderHook(
    () =>
      names(
        useAccounts(serverSeed(accountsResponse("Smoke Checking"), now - 5_000))
          .data,
      ),
    { wrapper },
  );

  await waitFor(() => assert.deepEqual(result.current, ["Smoke Checking"]));
  assert.deepEqual(api.requests, []);
});

test("cached data newer than the server's snapshot is kept", async () => {
  const now = Date.now();
  // A mutation refetched the list after the server rendered (or back navigation replayed an
  // older payload): the cache is the newer of the two.
  queryClient.setQueryData(
    ["accounts"],
    accountsResponse("Savings", "Checking"),
    {
      updatedAt: now - 1_000,
    },
  );

  const { result } = renderHook(
    () =>
      names(
        useAccounts(serverSeed(accountsResponse("Savings"), now - 20_000)).data,
      ),
    { wrapper },
  );

  // Give a wrongful overwrite every chance to land before checking.
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(result.current, ["Savings", "Checking"]);
  assert.deepEqual(api.requests, []);
});

test("the server's data for one account never overwrites another account the user moves to", async () => {
  const now = Date.now();
  const account = (accountName: string) =>
    ({ accountName }) as unknown as GetAccountResponse;
  queryClient.setQueryData(["account", 2], account("Account two, cached"), {
    updatedAt: now - 30_000,
  });

  const { result, rerender } = renderHook(
    ({ id }: { id: number }) =>
      (
        useAccount(
          id,
          serverSeed(account("Account one, from the server"), now - 1_000),
        ).data as { accountName: string } | undefined
      )?.accountName,
    { initialProps: { id: 1 }, wrapper },
  );
  assert.equal(result.current, "Account one, from the server");

  rerender({ id: 2 });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(result.current, "Account two, cached");
});

test("an infinite transactions list adopts the newer first page the server rendered", async () => {
  const now = Date.now();
  const page = (description: string) =>
    ({
      limit: 50,
      total: 1,
      transactions: [{ description }],
    }) as unknown as GetTransactionsResponse;
  queryClient.setQueryData(
    ["accounts-transactions-infinite", {}],
    { pageParams: [undefined], pages: [page("Old coffee")] },
    { updatedAt: now - 30_000 },
  );

  const { result } = renderHook(
    () =>
      useInfiniteTransactions(
        {},
        serverSeed(page("Rent"), now - 2_000),
      ).data?.transactions.map(
        (transaction) =>
          (transaction as unknown as { description: string }).description,
      ),
    { wrapper },
  );

  await waitFor(() => assert.deepEqual(result.current, ["Rent"]));
  assert.deepEqual(api.requests, []);
});
