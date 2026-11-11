// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, test, vi } from "vitest";

import type { Portfolio } from "@/lib/api/portfolio/usePortfolio";
import useUpdatePortfolio from "@/lib/api/portfolio/useUpdatePortfolio";

import messages from "../../messages/en/common.json";
import PortfolioSettingsModal from "./PortfolioSettingsModal";

const mutateAsync = vi.fn().mockResolvedValue(undefined);

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/lib/api/account/useAccounts", () => ({
  default: () => ({ data: { accounts: [] } }),
}));
vi.mock("@/lib/api/portfolio/useUpdatePortfolio", () => ({ default: vi.fn() }));
vi.mock("@/components/ui/dialog-responsive", () => ({
  DrawerDialog: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

afterEach(() => {
  cleanup();
  mutateAsync.mockClear();
});

const portfolio: Portfolio = {
  balance: 0,
  costBasisMethod: "FIFO",
  currencyKey: { code: "EUR" },
  name: "Shares",
  portfolioKey: 7,
};

function renderModal() {
  vi.mocked(useUpdatePortfolio).mockReturnValue({
    isPending: false,
    mutateAsync,
  } as unknown as ReturnType<typeof useUpdatePortfolio>);

  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <PortfolioSettingsModal
        closeModal={vi.fn()}
        isOpen
        portfolio={portfolio}
      />
    </NextIntlClientProvider>,
  );
}

test("saves a changed cost basis method", async () => {
  const user = userEvent.setup();
  renderModal();

  assert.ok(screen.getByText("FIFO (oldest lots first)"));
  await user.click(screen.getByLabelText(/Average cost/));
  await user.click(screen.getByRole("button", { name: "Save" }));

  await waitFor(() =>
    assert.equal(mutateAsync.mock.calls.length, 1),
  );
  assert.deepEqual(mutateAsync.mock.calls[0]?.[0], {
    costBasisMethod: "AVERAGE",
    description: null,
    name: "Shares",
    portfolioId: 7,
  });
});

test("does not send the method when it did not change", async () => {
  const user = userEvent.setup();
  renderModal();

  await user.click(screen.getByRole("button", { name: "Save" }));

  await waitFor(() =>
    assert.equal(mutateAsync.mock.calls.length, 1),
  );
  assert.equal(
    Object.hasOwn(mutateAsync.mock.calls[0]?.[0] ?? {}, "costBasisMethod"),
    false,
  );
});
