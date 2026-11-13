// @vitest-environment jsdom
import assert from "node:assert/strict";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, test, vi } from "vitest";

import type { ExpenseGroup } from "@/lib/api/expense-group/types";

import enCommon from "../../messages/en/common.json";
import enExpenseGroups from "../../messages/en/expense-groups.json";
import { EditExpenseGroupForm } from "./EditExpenseGroupForm";

const apiMock = vi.hoisted(() => ({
  get: vi.fn(),
  patch: vi.fn(),
}));
vi.mock("@/lib/api/api", () => ({ default: apiMock }));
const captureMock = vi.hoisted(() => vi.fn());
vi.mock("posthog-js/react", () => ({
  usePostHog: () => ({ capture: captureMock }),
}));
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));

afterEach(cleanup);

const trip: ExpenseGroup = {
  expenseGroupKey: 4,
  name: "Lisbon trip",
  currencyCode: "EUR",
  archived: false,
  createdAt: "2026-11-01T00:00:00.000Z",
  members: [],
  yourBalances: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.get.mockImplementation(async (url: string) => {
    if (url === "/v1/account/currencies") {
      return {
        data: {
          currencies: [
            { currencyKey: 1, code: "EUR", description: "Euro" },
            { currencyKey: 2, code: "USD", description: "US dollar" },
          ],
        },
      };
    }
    throw new Error(`unexpected GET ${url}`);
  });
});

function renderForm() {
  const onDone = vi.fn();
  const onCancel = vi.fn();
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <NextIntlClientProvider
        locale="en"
        messages={{ ...enCommon, ...enExpenseGroups }}
      >
        <EditExpenseGroupForm
          group={trip}
          onDone={onDone}
          onCancel={onCancel}
        />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  return { onDone, onCancel };
}

const nameField = () =>
  screen.getByRole("textbox", { name: "Name" }) as HTMLInputElement;
const currencyField = () =>
  screen.getByRole("combobox", { name: "Currency" }) as HTMLSelectElement;
const save = () => screen.getByRole("button", { name: "Save" });

test("starts from the group's name and currency, and saves a new name and currency", async () => {
  const user = userEvent.setup();
  apiMock.patch.mockResolvedValue({
    data: { group: { ...trip, name: "Porto trip", currencyCode: "USD" } },
  });
  const { onDone } = renderForm();

  assert.equal(nameField().value, "Lisbon trip");
  assert.equal(currencyField().value, "EUR");
  // Changing it moves nothing already recorded.
  screen.getByText(
    "New settlements use it. Shared expenses and settlements already recorded keep their own currency, and balances stay per currency.",
  );

  await user.clear(nameField());
  await user.type(nameField(), "  Porto trip ");
  await screen.findByRole("option", { name: "USD" });
  await user.selectOptions(currencyField(), "USD");
  await user.click(save());

  await waitFor(() => assert.equal(apiMock.patch.mock.calls.length, 1));
  assert.deepEqual(apiMock.patch.mock.calls[0], [
    "/v1/expense-groups/4",
    { name: "Porto trip", currencyCode: "USD" },
  ]);
  await waitFor(() => assert.equal(onDone.mock.calls.length, 1));
  assert.deepEqual(toastMock.success.mock.calls[0], ["Group updated"]);
  assert.deepEqual(captureMock.mock.calls[0], [
    "expense_group_updated",
    { renamed: true, currency_changed: true },
  ]);
});

test("a rename alone sends only the name", async () => {
  const user = userEvent.setup();
  apiMock.patch.mockResolvedValue({ data: { group: trip } });
  renderForm();

  await user.clear(nameField());
  await user.type(nameField(), "Porto trip");
  await user.click(save());

  await waitFor(() => assert.equal(apiMock.patch.mock.calls.length, 1));
  assert.deepEqual(apiMock.patch.mock.calls[0], [
    "/v1/expense-groups/4",
    { name: "Porto trip" },
  ]);
});

test("a group needs a name", async () => {
  const user = userEvent.setup();
  const { onDone } = renderForm();

  await user.clear(nameField());
  await user.click(save());

  screen.getByText("Give the group a name.");
  assert.equal(nameField().getAttribute("aria-invalid"), "true");
  assert.equal(apiMock.patch.mock.calls.length, 0);
  assert.equal(onDone.mock.calls.length, 0);
});

test("nothing changed closes without a request", async () => {
  const user = userEvent.setup();
  const { onDone } = renderForm();

  await user.click(save());

  assert.equal(apiMock.patch.mock.calls.length, 0);
  assert.equal(onDone.mock.calls.length, 1);
  assert.equal(toastMock.success.mock.calls.length, 0);
});

test("the API's refusal stays in the form, in words", async () => {
  const user = userEvent.setup();
  apiMock.patch.mockRejectedValue({
    response: { status: 404, data: { code: "not_found" } },
  });
  const { onDone } = renderForm();

  await user.clear(nameField());
  await user.type(nameField(), "Porto trip");
  await user.click(save());

  const alert = await screen.findByRole("alert");
  assert.equal(
    alert.textContent,
    "It was not found. It may have been deleted, or be on another member's private account.",
  );
  assert.equal(onDone.mock.calls.length, 0);
  // The draft stays, to try again.
  assert.equal(nameField().value, "Porto trip");
});

test("a refusal this client has no words for falls back to a plain one", async () => {
  const user = userEvent.setup();
  apiMock.patch.mockRejectedValue({
    response: { status: 400, data: { code: "bad_request" } },
  });
  renderForm();

  await screen.findByRole("option", { name: "USD" });
  await user.selectOptions(currencyField(), "USD");
  await user.click(save());

  const alert = await screen.findByRole("alert");
  assert.equal(alert.textContent, "This could not be saved. Try again.");
});
