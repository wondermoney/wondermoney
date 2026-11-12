// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, test, vi } from "vitest";

import type { TransactionMerchant } from "@/lib/api/account/useTransactionMerchants";

import commonMessages from "../../messages/en/common.json";
import transactionMessages from "../../messages/en/transactions.json";
import { MerchantDetails } from "./MerchantDetails";

const state = vi.hoisted(() => ({ edit: vi.fn() }));

vi.mock("@/lib/api/account/useEditTransactionMerchant", () => ({
  default: () => ({ mutateAsync: state.edit, isPending: false }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

afterEach(() => {
  cleanup();
  state.edit.mockReset();
});

const merchant: TransactionMerchant = {
  transactionMerchantKey: 42,
  name: "Café Nero",
  website: "https://cafenero.example",
  logoUrl: null,
  resolvedLogoUrl: null,
};

function renderDetails(onSaved = vi.fn()) {
  render(
    <NextIntlClientProvider
      locale="en"
      messages={{ ...commonMessages, ...transactionMessages }}
    >
      <MerchantDetails merchant={merchant} onSaved={onSaved} />
    </NextIntlClientProvider>,
  );
  return { onSaved };
}

test("saves the website and logo, sending an emptied field as null", async () => {
  const saved = {
    ...merchant,
    website: null,
    logoUrl: "https://cdn.example.com/n.png",
  };
  state.edit.mockResolvedValue({ transactionMerchant: saved });
  const { onSaved } = renderDetails();

  await userEvent.click(
    screen.getByRole("button", { name: "Edit merchant details" }),
  );
  const website = screen.getByLabelText("Website");
  assert.equal((website as HTMLInputElement).value, "https://cafenero.example");
  await userEvent.clear(website);
  await userEvent.type(
    screen.getByLabelText("Logo URL"),
    "https://cdn.example.com/n.png",
  );
  assert.ok(
    screen.getByText(/loaded by the browser of everyone in your household/),
  );
  await userEvent.click(screen.getByRole("button", { name: "Save" }));

  await waitFor(() => assert.equal(onSaved.mock.calls.length, 1));
  assert.deepEqual(state.edit.mock.calls[0], [
    {
      transactionMerchantKey: 42,
      website: null,
      logoUrl: "https://cdn.example.com/n.png",
    },
  ]);
  assert.deepEqual(onSaved.mock.calls[0], [saved]);
});

test("an http address is refused before it is sent", async () => {
  renderDetails();

  await userEvent.click(
    screen.getByRole("button", { name: "Edit merchant details" }),
  );
  await userEvent.type(
    screen.getByLabelText("Logo URL"),
    "http://cdn.example.com/n.png",
  );
  await userEvent.click(screen.getByRole("button", { name: "Save" }));

  await screen.findByText("Enter a full address that starts with https://.");
  assert.equal(state.edit.mock.calls.length, 0);
});

test("the API's validation refusal is shown on the form", async () => {
  state.edit.mockRejectedValue({
    response: {
      status: 400,
      data: { code: "bad_request", message: "Validation error" },
    },
  });
  const { onSaved } = renderDetails();

  await userEvent.click(
    screen.getByRole("button", { name: "Edit merchant details" }),
  );
  await userEvent.click(screen.getByRole("button", { name: "Save" }));

  const alert = await screen.findByRole("alert");
  assert.match(alert.textContent ?? "", /were not accepted/);
  assert.equal(onSaved.mock.calls.length, 0);
});
