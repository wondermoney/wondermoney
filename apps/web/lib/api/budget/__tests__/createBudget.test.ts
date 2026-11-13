import assert from "node:assert/strict";

import { test } from "vitest";

import { type BudgetCreateClient, createBudget } from "../useCreateBudget";

function recordingClient() {
  const calls: { url: string; body: unknown }[] = [];
  const client = {
    post: async (url: string, body: unknown) => {
      calls.push({ url, body });
      return { data: { budgetKey: 7 } };
    },
  } as unknown as BudgetCreateClient;
  return { calls, client };
}

const request = {
  houseHoldSize: 2,
  dependentsNum: 0,
  incomes: [{ name: "Salary", amount: 2000, isRecurrent: true, recurrency: "MONTHLY" }],
};

test("a personal budget is created with its visibility in the body", async () => {
  const { calls, client } = recordingClient();

  const response = await createBudget({ ...request, visibility: "personal" }, client);

  assert.equal(response.data.budgetKey, 7);
  assert.deepEqual(calls, [
    { url: "/v1/budget", body: { ...request, visibility: "personal" } },
  ]);
});

test("a budget created without a choice is a household budget", async () => {
  const { calls, client } = recordingClient();

  await createBudget(request, client);

  assert.deepEqual(calls, [
    { url: "/v1/budget", body: { ...request, visibility: "household" } },
  ]);
});
