// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";

import commonMessages from "../../messages/en/common.json";
import AccountEditSheet from "./AccountEditSheet";

vi.mock("posthog-js/react", () => ({
  usePostHog: () => ({ capture: () => {} }),
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: () => Promise.resolve() }),
}));
vi.mock("@/lib/api/account/useEditAccount", () => ({
  default: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock("@/lib/api/account/useUpdateCreditCard", () => ({
  default: () => ({ mutateAsync: vi.fn() }),
}));

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});
afterEach(cleanup);

function renderSheet(creditCard: Parameters<typeof AccountEditSheet>[0]["creditCard"]) {
  return render(
    <NextIntlClientProvider locale="en" messages={commonMessages}>
      <AccountEditSheet
        accountKey={7}
        accountName="Everyday card"
        creditCard={creditCard}
        isOpen
        isOwnedByViewer
        isPrivate={false}
        onOpenChange={() => {}}
      />
    </NextIntlClientProvider>,
  );
}

describe("credit card settings in the account edit sheet", () => {
  test("offers a card toggle and asks for the cycle once it is on", () => {
    renderSheet(null);

    const toggle = screen.getByRole("switch", { name: "Credit card account" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(screen.queryByLabelText("Statement closes on")).toBeNull();

    fireEvent.click(toggle);

    expect(screen.getByLabelText("Statement closes on")).toBeTruthy();
    expect(screen.getByLabelText("Payment due on")).toBeTruthy();
    expect(screen.getByLabelText("Credit limit")).toBeTruthy();
  });

  test("prefills the cycle of an account that is already a card and locks the toggle", () => {
    renderSheet({
      statementCloseDay: 25,
      paymentDueDay: 10,
      creditLimit: 1500,
      minimumPaymentPercent: 5,
    });

    const toggle = screen.getByRole("switch", { name: "Credit card account" });
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect((toggle as HTMLButtonElement).disabled).toBe(true);
    expect(
      (screen.getByLabelText("Statement closes on") as HTMLInputElement).value,
    ).toBe("25");
    expect(
      (screen.getByLabelText("Payment due on") as HTMLInputElement).value,
    ).toBe("10");
    expect(
      (screen.getByLabelText("Credit limit") as HTMLInputElement).value,
    ).toBe("1500");
  });
});
