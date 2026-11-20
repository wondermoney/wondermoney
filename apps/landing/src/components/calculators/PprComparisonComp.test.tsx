// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PPR_FUNDS_SOURCE, PPR_PRODUCTS, filterProducts, sortProducts } from "@/lib/calculators/pprComparison";

const pushGtmEvent = vi.fn();
vi.mock("@/lib/gtm", () => ({
  pushGtmEvent: (payload: unknown) => pushGtmEvent(payload),
  getPageType: () => "tools/x",
}));

const { default: PprComparisonComp } = await import("./PprComparisonComp");

afterEach(() => {
  cleanup();
  pushGtmEvent.mockClear();
  vi.useRealTimers();
});

const rows = () => [...document.querySelectorAll("ol > li")];

it("shows the data dates, the first page of products by name, and no warning while the data is recent", () => {
  vi.useFakeTimers({ now: new Date(`${PPR_FUNDS_SOURCE.fetchedOn}T12:00:00Z`), toFake: ["Date"] });
  render(<PprComparisonComp locale="en" />);
  expect(screen.getByText(/PPR investment funds: the CMVM's list, read on/)).toBeTruthy();
  expect(screen.queryByText("These figures may be out of date")).toBeNull();
  expect(screen.getByText(`${PPR_PRODUCTS.length} PPR match`)).toBeTruthy();
  expect(rows()).toHaveLength(20);
  const first = sortProducts(PPR_PRODUCTS, "name")[0];
  expect(rows()[0].textContent).toContain(first.name);
  expect(pushGtmEvent).not.toHaveBeenCalled();
});

it("warns when the CMVM list is more than two months old", () => {
  vi.useFakeTimers({ now: new Date(Date.parse(`${PPR_FUNDS_SOURCE.fetchedOn}T12:00:00Z`) + 90 * 86_400_000), toFake: ["Date"] });
  render(<PprComparisonComp locale="en" />);
  expect(screen.getAllByText("These figures may be out of date").length).toBeGreaterThan(0);
});

it("filters by type and risk class, sorts by cost and reports one use without data", () => {
  render(<PprComparisonComp locale="en" />);
  fireEvent.change(screen.getByLabelText("Type"), { target: { value: "pensionFund" } });
  fireEvent.change(screen.getByLabelText("Risk class"), { target: { value: "4" } });
  fireEvent.change(screen.getByLabelText("Sort by"), { target: { value: "cost" } });
  const expected = sortProducts(filterProducts(PPR_PRODUCTS, { kind: "pensionFund", riskClass: 4, query: "" }), "cost");
  expect(screen.getByText(`${expected.length} PPR match`)).toBeTruthy();
  expect(rows()[0].textContent).toContain(expected[0].name);
  expect(document.body.textContent).toContain("Risk class 4:");
  expect(pushGtmEvent).toHaveBeenCalledTimes(1);
  expect(pushGtmEvent).toHaveBeenCalledWith({ event: "tool_used", tool: "ppr_comparison", page_type: "tools/x" });
});

it("warns when returns are sorted across risk classes, and shows an empty state", () => {
  render(<PprComparisonComp locale="en" />);
  fireEvent.change(screen.getByLabelText("Sort by"), { target: { value: "return5" } });
  expect(screen.getByText(/You are sorting by return across every risk class/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Search"), { target: { value: "no such product xyz" } });
  expect(screen.getByText("No PPR matches these filters.")).toBeTruthy();
});

it("shows funds' fees as not in the CMVM list and links the fund's IFI", () => {
  render(<PprComparisonComp locale="en" />);
  fireEvent.change(screen.getByLabelText("Type"), { target: { value: "fund" } });
  expect(rows()[0].textContent).toContain("not in the CMVM list");
  expect(rows()[0].querySelector('a[href^="https://investidor.cmvm.pt/PInvestidor/PDF_fundo"]')).toBeTruthy();
});

it("works out the IRS deduction and handles retirement, empty and large values", () => {
  render(<PprComparisonComp locale="en" />);
  expect(screen.getByText("Deduction from your IRS tax: €200")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Contributions this year"), { target: { value: "5000" } });
  expect(screen.getByText("Deduction from your IRS tax: €350")).toBeTruthy();
  expect(screen.getByText("Contributions above €1,750 add nothing to this year's deduction.")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Age on 1 January"), { target: { value: "" } });
  expect(screen.getByText("Correct the fields above to see the deduction.")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Age on 1 January"), { target: { value: "30" } });
  fireEvent.change(screen.getByLabelText("Contributions this year"), { target: { value: "0" } });
  expect(screen.getByText("Deduction from your IRS tax: €0")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Contributions this year"), { target: { value: "99999999999" } });
  expect(screen.getByText("Correct the fields above to see the deduction.")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Contributions this year"), { target: { value: "1000" } });
  fireEvent.click(screen.getByLabelText("I was already retired when I contributed"));
  expect(screen.getByText(/Contributions made after you retire are not deductible/)).toBeTruthy();
});

it("renders in Portuguese without the English copy", () => {
  render(<PprComparisonComp locale="pt" />);
  act(() => {});
  expect(document.body.textContent).not.toContain("PPR match");
  expect(document.body.textContent).toContain("Compara os PPR em comercialização");
});
