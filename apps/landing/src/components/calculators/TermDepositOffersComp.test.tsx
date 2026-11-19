// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const pushGtmEvent = vi.fn();
vi.mock("@/lib/gtm", () => ({
  pushGtmEvent: (payload: unknown) => pushGtmEvent(payload),
  getPageType: () => "tools/term-deposit-comparison-portugal",
}));

const { default: TermDepositOffersComp } = await import("./TermDepositOffersComp");

afterEach(() => {
  cleanup();
  pushGtmEvent.mockClear();
});

// The component renders a phone card list and a desktop table: count rows in the table.
const tableRows = () => document.querySelectorAll("table tbody tr").length;

it("shows the as-of date, the offers sorted by rate and the net interest for the amount", () => {
  render(<TermDepositOffersComp locale="en" />);
  expect(screen.getAllByText(/2026-11-19/).length).toBeGreaterThan(0);
  const first = document.querySelector("table tbody tr");
  expect(first?.textContent).toContain("BiG");
  expect(first?.textContent).toContain("4.00%");
  // 10,000 at 4% for 3 months: 72.00 after 28% IRS.
  expect(first?.textContent).toContain("€72.00");
  expect(document.body.textContent).toContain("Original conditions in Portuguese");
  expect(document.body.textContent).toContain("+0,10% para < 30 anos, ACP, ordens profissionais");
  expect(document.body.textContent).toContain("Fundo de Garantia de Depósitos");
  expect(document.querySelector('a[href="https://www.fgd.pt/en"]')).toBeTruthy();
  expect(document.querySelector('a[href="/en/tools/term-deposit-rate-index-portugal"]')).toBeTruthy();
  expect(pushGtmEvent).not.toHaveBeenCalled();
});

it("filters by amount, term and conditions and reports one use without inputs", () => {
  render(<TermDepositOffersComp locale="en" />);
  const all = tableRows();

  // 1,000 euros hides every offer whose minimum is higher.
  fireEvent.change(screen.getByLabelText("Amount I want to invest"), { target: { value: "1000" } });
  const small = tableRows();
  expect(small).toBeLessThan(all);
  expect(document.querySelector("table tbody")?.textContent).not.toContain("BiG");

  fireEvent.change(screen.getByLabelText("Amount I want to invest"), { target: { value: "60000" } });
  fireEvent.change(screen.getByLabelText("Term"), { target: { value: "12" } });
  const text = document.querySelector("table tbody")?.textContent ?? "";
  expect(text).toContain("Haitong Bank");
  expect(text).not.toContain("Klarna");

  fireEvent.click(screen.getByLabelText(/Early withdrawal allowed/));
  fireEvent.click(screen.getByLabelText(/For existing clients/));
  fireEvent.change(screen.getByLabelText("Bank and IRS"), { target: { value: "notWithheld" } });
  expect(screen.getByText(/No offer matches/)).toBeTruthy();

  expect(pushGtmEvent).toHaveBeenCalledExactlyOnceWith({
    event: "tool_used",
    tool: "term_deposit_offers",
    page_type: "tools/term-deposit-comparison-portugal",
  });
});

it("gives a clear message for an empty amount and still lists every offer", () => {
  render(<TermDepositOffersComp locale="en" />);
  const amount = screen.getByLabelText("Amount I want to invest");
  fireEvent.change(amount, { target: { value: "" } });
  expect(amount.getAttribute("aria-invalid")).toBe("true");
  expect(tableRows()).toBe(49);
});

it("labels the notes in Portuguese on the pt page", () => {
  render(<TermDepositOffersComp locale="pt" />);
  expect(document.body.textContent).toContain("Notas do banco");
  expect(document.body.textContent).not.toContain("Original conditions in Portuguese");
});
