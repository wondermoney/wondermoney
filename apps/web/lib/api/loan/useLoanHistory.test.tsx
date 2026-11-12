// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import {
  useLoanAdjustmentMutations,
  useLoanRateMutations,
} from "./useLoanHistory";

const apiMock = vi.hoisted(() => ({
  post: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
}));
vi.mock("../api", () => ({ default: apiMock }));

function Buttons() {
  const adjustments = useLoanAdjustmentMutations(5);
  const rates = useLoanRateMutations(5);
  return (
    <>
      <button
        onClick={() =>
          void adjustments.create.mutateAsync({
            type: "FEE",
            effectiveDate: "2026-01-01",
            amount: 2,
          })
        }
      >
        Add adjustment
      </button>
      <button
        onClick={() =>
          void rates.update.mutateAsync({
            key: 9,
            body: { annualInterestRateBps: 450 },
          })
        }
      >
        Edit rate
      </button>
    </>
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function setup() {
  const client = new QueryClient();
  const invalidated: unknown[] = [];
  const original = client.invalidateQueries.bind(client);
  client.invalidateQueries = ((filters?: Parameters<typeof original>[0]) => {
    invalidated.push(filters?.queryKey);
    return original(filters);
  }) as typeof client.invalidateQueries;
  render(
    <QueryClientProvider client={client}>
      <Buttons />
    </QueryClientProvider>,
  );
  return invalidated;
}

it("sends adjustments and rate changes to the loan's routes", async () => {
  apiMock.post.mockResolvedValue({});
  apiMock.patch.mockResolvedValue({});
  setup();
  fireEvent.click(screen.getByRole("button", { name: "Add adjustment" }));
  fireEvent.click(screen.getByRole("button", { name: "Edit rate" }));

  await waitFor(() =>
    expect(apiMock.post).toHaveBeenCalledWith("/v1/loan/5/adjustments", {
      type: "FEE",
      effectiveDate: "2026-01-01",
      amount: 2,
    }),
  );
  await waitFor(() =>
    expect(apiMock.patch).toHaveBeenCalledWith("/v1/loan/5/rate-periods/9", {
      annualInterestRateBps: 450,
    }),
  );
});

it("refreshes the loan (with its schedule, projection and lists), the loan totals, net worth and the assets loans secure", async () => {
  apiMock.post.mockResolvedValue({});
  const invalidated = setup();
  fireEvent.click(screen.getByRole("button", { name: "Add adjustment" }));

  await waitFor(() => expect(invalidated).toHaveLength(5));
  expect(invalidated).toEqual([
    ["loan", 5],
    ["loans"],
    ["net-worth"],
    ["manual-assets"],
    ["manual-asset"],
  ]);
});
