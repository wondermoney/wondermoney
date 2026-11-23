// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const pushGtmEvent = vi.fn();
vi.mock("@/lib/gtm", () => ({
  pushGtmEvent: (payload: unknown) => pushGtmEvent(payload),
  getPageType: () => "tools/x",
}));

const { default: FreeBankAccountsComp } = await import("./FreeBankAccountsComp");
const { default: RemuneratedAccountsComp } = await import("./RemuneratedAccountsComp");

afterEach(() => {
  cleanup();
  pushGtmEvent.mockClear();
});

it("lists the free accounts, shows the date, filters by two holders and reports one use without data", () => {
  render(<FreeBankAccountsComp locale="en" />);
  expect(screen.getByText("Conditions as of 19 Nov 2026")).toBeTruthy();
  expect(screen.getByText("Showing 14 of 14 accounts")).toBeTruthy();
  // Notes are the table's own Portuguese, labelled as original conditions.
  expect(document.body.textContent).toContain("Sem balcões, depósito de numerário ou cheque, homebanking para PC/browser");
  expect(document.querySelectorAll('ul[lang="pt"]').length).toBeGreaterThan(0);
  expect(document.body.textContent).toContain("Original conditions, in Portuguese");
  expect(document.body.textContent).toContain("Fundo de Garantia de Depósitos");
  expect(pushGtmEvent).not.toHaveBeenCalled();

  fireEvent.click(screen.getByLabelText("Show only accounts that allow two holders"));
  expect(screen.getByText("Showing 9 of 14 accounts")).toBeTruthy();
  fireEvent.click(screen.getByLabelText("Show only accounts that allow two holders"));
  expect(pushGtmEvent).toHaveBeenCalledTimes(1);
  expect(pushGtmEvent).toHaveBeenCalledWith({ event: "tool_used", tool: "free_bank_accounts", page_type: "tools/x" });
});

it("puts a logo beside every bank's name and the date note after the list", () => {
  render(<FreeBankAccountsComp locale="en" />);
  const rows = document.querySelectorAll("table tbody tr");
  expect(rows.length).toBe(14);
  for (const row of rows) {
    const logo = row.querySelector("th img");
    expect(logo?.getAttribute("alt")).toBe("");
    expect(logo?.closest("[aria-hidden]")).toBeTruthy();
  }
  // The name stays the row's label.
  expect(rows[0].querySelector("th")?.textContent).toContain("Activo Bank");
  const asOf = screen.getByText("Conditions as of 19 Nov 2026");
  const lastTable = [...document.querySelectorAll("table")].at(-1) as Element;
  expect(lastTable.compareDocumentPosition(asOf) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(document.body.textContent).toContain("All trademarks mentioned belong to their respective owners.");
});

it("does not label the Portuguese notes on the pt page", () => {
  render(<FreeBankAccountsComp locale="pt" />);
  expect(document.body.textContent).not.toContain("Condições originais, em português");
});

it("calculates net interest, caps it, and shows ranges per plan without one number", () => {
  render(<RemuneratedAccountsComp locale="en" />);
  expect(screen.getByText("Conditions as of 19 Nov 2026")).toBeTruthy();
  const table = screen.getAllByRole("table")[0];
  const rows = within(table).getAllByRole("row");
  // header + 15 rows, highest rate first
  expect(rows).toHaveLength(16);
  expect(rows[1].textContent).toContain("Conta Mais Ordenado");
  // 10 000 at 5.00% capped at 10 000: 500 - 140 = 360
  expect(rows[1].textContent).toContain("€360.00");
  // Range row shows the range and each plan.
  const revolut = rows.find((row) => row.textContent?.includes("Poupança Acesso Imediato"));
  expect(revolut?.textContent).toContain("1.50% to 2.75%");
  expect(revolut?.textContent).toContain("Ultra");
  expect(pushGtmEvent).not.toHaveBeenCalled();

  fireEvent.change(screen.getByLabelText("Amount saved"), { target: { value: "50000" } });
  expect(within(screen.getAllByRole("table")[0]).getAllByRole("row")[1].textContent).toContain("Interest is paid only up to €10,000");
  expect(pushGtmEvent).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(pushGtmEvent.mock.calls)).not.toMatch(/50000|360/);
});

it("filters by type, tax treatment and holders, and sorts by rate", () => {
  render(<RemuneratedAccountsComp locale="en" />);
  fireEvent.change(screen.getByLabelText("Type"), { target: { value: "dividaPublica" } });
  expect(screen.getByText("Showing 1 of 15 accounts")).toBeTruthy();
  expect(document.body.textContent).toContain("Open the savings certificates tool");
  fireEvent.change(screen.getByLabelText("Type"), { target: { value: "any" } });
  fireEvent.change(screen.getByLabelText("IRS"), { target: { value: "foreign" } });
  expect(screen.getByText("Showing 7 of 15 accounts")).toBeTruthy();
  fireEvent.click(screen.getByLabelText("Allows two holders"));
  expect(screen.getByText("Showing 1 of 15 accounts")).toBeTruthy();
  fireEvent.click(screen.getByLabelText("Allows two holders"));
  fireEvent.change(screen.getByLabelText("IRS"), { target: { value: "any" } });
  fireEvent.change(screen.getByLabelText("Sort by"), { target: { value: "tanbAsc" } });
  expect(within(screen.getAllByRole("table")[0]).getAllByRole("row")[1].textContent).toContain("Poupança Acesso Imediato");
});

it("gives a clear message for an empty amount and hides the net figures", () => {
  render(<RemuneratedAccountsComp locale="en" />);
  const amount = screen.getByLabelText("Amount saved");
  fireEvent.change(amount, { target: { value: "" } });
  expect(amount.getAttribute("aria-invalid")).toBe("true");
  expect(document.body.textContent).toContain("Enter an amount.");
});
