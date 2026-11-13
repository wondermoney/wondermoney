// @vitest-environment jsdom
import assert from "node:assert/strict";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, test, vi } from "vitest";

import enHousehold from "../../messages/en/household.json";
import { HouseholdReadOnlyNotifier } from "./HouseholdReadOnlyNotifier";

const state = vi.hoisted(() => ({
  toasts: [] as Array<{ id?: string; message: string }>,
}));

vi.mock("sonner", () => ({
  toast: {
    error: (message: string, options?: { id?: string }) =>
      state.toasts.push({ id: options?.id, message }),
  },
}));

afterEach(() => {
  cleanup();
  state.toasts = [];
});

const refusal = (code: string) => ({
  response: { data: { code }, status: 403 },
});

async function failMutation(client: QueryClient, error: unknown) {
  await client
    .getMutationCache()
    .build(client, {
      mutationFn: () => Promise.reject(error),
      retry: false,
    })
    .execute(undefined)
    .catch(() => {});
}

test("a viewer's refused write explains view-only access, once per burst", async () => {
  const client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="en" messages={enHousehold}>
        <HouseholdReadOnlyNotifier />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );

  await failMutation(client, refusal("demo_read_only"));
  assert.equal(state.toasts.length, 0);

  await failMutation(client, refusal("household_read_only"));
  await failMutation(client, refusal("household_read_only"));
  assert.equal(state.toasts.length, 2);
  // Both carry one id, so sonner shows a single toast.
  assert.equal(new Set(state.toasts.map((t) => t.id)).size, 1);
  assert.equal(state.toasts[0]!.message, enHousehold.household.readOnly.title);
});
