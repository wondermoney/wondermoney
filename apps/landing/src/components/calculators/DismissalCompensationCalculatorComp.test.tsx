// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DISMISSAL_EXAMPLE, computeDismissalCompensation } from "@/lib/calculators/dismissalCompensation";

const pushGtmEvent = vi.fn();
vi.mock("@/lib/gtm", () => ({
  pushGtmEvent: (payload: unknown) => pushGtmEvent(payload),
  getPageType: () => "tools/portugal-dismissal-compensation-calculator",
}));

const { default: DismissalCompensationCalculatorComp } = await import("./DismissalCompensationCalculatorComp");

/** The headline figure: the first value of the result ledger. */
const headline = () => document.querySelector("#dismissal-result dd")?.textContent;

afterEach(() => {
  cleanup();
  pushGtmEvent.mockClear();
});

it("shows the example, explains edge cases and tracks one edit with metadata only", () => {
  const outcome = computeDismissalCompensation(DISMISSAL_EXAMPLE, "2026-11-19");
  if (!outcome.ok) throw new Error("example must be valid");
  const euros = (cents: number) =>
    new Intl.NumberFormat("en", { style: "currency", currency: "EUR" }).format(cents / 100);

  render(<DismissalCompensationCalculatorComp locale="en" />);
  expect(headline()).toBe(euros(outcome.result.compensationCents));
  expect(screen.getByText("Payout split over upcoming months")).toBeTruthy();
  expect(pushGtmEvent).not.toHaveBeenCalled();

  const end = screen.getByLabelText("Termination date");
  fireEvent.change(end, { target: { value: "2012-01-01" } });
  expect(end.getAttribute("aria-invalid")).toBe("true");
  expect(screen.getByText("The termination date cannot be before the start date.")).toBeTruthy();
  expect(headline()).toBeUndefined();
  expect(pushGtmEvent).not.toHaveBeenCalled();

  fireEvent.change(end, { target: { value: "2026-12-31" } });
  const base = screen.getByRole("spinbutton", { name: "Monthly base pay (gross)" });
  fireEvent.change(base, { target: { value: "0" } });
  expect(screen.getByText(/Enter a value of at least/)).toBeTruthy();
  fireEvent.change(base, { target: { value: "2000" } });
  expect(headline()).toBeDefined();
  expect(pushGtmEvent).toHaveBeenCalledExactlyOnceWith({
    event: "tool_used", tool: "dismissal_compensation", page_type: "tools/portugal-dismissal-compensation-calculator",
  });
});

it("switches to fixed-term expiry: 24 days a year on the whole duration, with its own scope and start-date help", () => {
  render(<DismissalCompensationCalculatorComp locale="en" />);
  const type = screen.getByLabelText("Type of termination");
  fireEvent.change(type, { target: { value: "fixedTerm" } });
  fireEvent.change(screen.getByLabelText("Contract start date"), { target: { value: "2025-01-01" } });
  fireEvent.change(screen.getByRole("spinbutton", { name: "Monthly base pay (gross)" }), { target: { value: "3000" } });
  fireEvent.change(screen.getByRole("spinbutton", { name: "Monthly seniority supplements (diuturnidades)" }), { target: { value: "0" } });
  const euros = new Intl.NumberFormat("en", { style: "currency", currency: "EUR" }).format(4800);
  expect(headline()).toBe(euros);
  expect(screen.getByText("Fixed-term contract expiry, 24 days a year")).toBeTruthy();
  expect(screen.getByText(/Covers the expiry of a fixed-term contract/)).toBeTruthy();
  expect(screen.getByText(/If it was renewed, count from the first day/)).toBeTruthy();
});

it("warns, without blocking the figure, when a fixed-term contract passes the art. 148 limit, and offers the dismissal option", () => {
  render(<DismissalCompensationCalculatorComp locale="en" />);
  expect(screen.queryByLabelText("Kind of term")).toBeNull();
  fireEvent.change(screen.getByLabelText("Type of termination"), { target: { value: "fixedTerm" } });
  fireEvent.change(screen.getByRole("spinbutton", { name: "Monthly base pay (gross)" }), { target: { value: "3000" } });
  fireEvent.change(screen.getByRole("spinbutton", { name: "Monthly seniority supplements (diuturnidades)" }), { target: { value: "0" } });
  const start = screen.getByLabelText("Contract start date");
  const end = screen.getByLabelText("Termination date");
  const kind = screen.getByLabelText("Kind of term") as HTMLSelectElement;
  expect(kind.value).toBe("certain");
  const euros = (amount: number) => new Intl.NumberFormat("en", { style: "currency", currency: "EUR" }).format(amount);

  // Exactly 2 years with a certain term: at the limit, no warning.
  fireEvent.change(start, { target: { value: "2025-01-01" } });
  fireEvent.change(end, { target: { value: "2026-12-31" } });
  expect(screen.queryByText("This contract may count as open-ended")).toBeNull();

  // 3 years: over it. The warning names the limit and the last lawful day, and the figure stays.
  fireEvent.change(start, { target: { value: "2024-01-01" } });
  expect(screen.getByText("This contract may count as open-ended")).toBeTruthy();
  expect(screen.getByText(/at most 2 years, renewals included \(art\. 148\(1\)/)).toBeTruthy();
  expect(screen.getByText(/December 31, 2025/)).toBeTruthy();
  expect(screen.getByText(/or the renewal limits converts into an open-ended contract \(art\. 147\(2\)\(a\) and \(b\)\)/)).toBeTruthy();
  expect(headline()).toBe(euros(7200));

  // An uncertain term may last 4 years.
  fireEvent.change(kind, { target: { value: "uncertain" } });
  expect(screen.queryByText("This contract may count as open-ended")).toBeNull();
  fireEvent.change(start, { target: { value: "2022-06-01" } });
  expect(screen.getByText(/at most 4 years \(art\. 148\(5\)/)).toBeTruthy();

  // A start before 1 October 2019 cites the earlier limits.
  fireEvent.change(start, { target: { value: "2019-09-30" } });
  expect(screen.getByText(/signed before 1 October 2019 keeps the earlier limits \(art\. 11\(4\) of Lei n\.º 93\/2019\): at most 6 years/)).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "Calculate as a dismissal on a permanent contract" }));
  expect((screen.getByLabelText("Type of termination") as HTMLSelectElement).value).toBe("permanent");
  expect(screen.queryByText("This contract may count as open-ended")).toBeNull();
  expect(screen.queryByLabelText("Kind of term")).toBeNull();
});

it("asks a certain-term contract for its renewals and earlier contracts, and warns without changing the figure", () => {
  render(<DismissalCompensationCalculatorComp locale="en" />);
  expect(screen.queryByLabelText("Number of renewals (optional)")).toBeNull();
  fireEvent.change(screen.getByLabelText("Type of termination"), { target: { value: "fixedTerm" } });
  fireEvent.change(screen.getByRole("spinbutton", { name: "Monthly base pay (gross)" }), { target: { value: "3000" } });
  fireEvent.change(screen.getByRole("spinbutton", { name: "Monthly seniority supplements (diuturnidades)" }), { target: { value: "0" } });
  fireEvent.change(screen.getByLabelText("Contract start date"), { target: { value: "2025-01-01" } });
  fireEvent.change(screen.getByLabelText("Termination date"), { target: { value: "2026-06-30" } });
  const figure = () => headline();
  const euros = figure();
  expect(euros).toMatch(/^€3,5\d\d\.\d\d$/);
  const warning = "This contract may count as open-ended";

  // The first period only matters once the contract was renewed.
  expect(screen.queryByLabelText("First period, in months (optional)")).toBeNull();
  const renewals = screen.getByRole("spinbutton", { name: "Number of renewals (optional)" });
  fireEvent.change(renewals, { target: { value: "3" } });
  expect(screen.queryByText(warning)).toBeNull();
  fireEvent.change(renewals, { target: { value: "4" } });
  expect(screen.getByText(warning)).toBeTruthy();
  expect(screen.getByText(/renewed at most three times \(art\. 149\(4\).*This one was renewed 4 times\./)).toBeTruthy();
  expect(figure()).toBe(euros);

  // Three renewals of a 6-month first period, to 30 June 2026: 12 months of renewals is longer than 6.
  fireEvent.change(renewals, { target: { value: "3" } });
  const initial = screen.getByRole("spinbutton", { name: "First period, in months (optional)" });
  fireEvent.change(initial, { target: { value: "9" } });
  expect(screen.queryByText(warning)).toBeNull();
  fireEvent.change(initial, { target: { value: "6" } });
  expect(screen.getByText(/With a first period of 6 months, the contract could run until December 31, 2025 at most\./)).toBeTruthy();
  expect(figure()).toBe(euros);
  fireEvent.change(initial, { target: { value: "" } });
  expect(screen.queryByText(warning)).toBeNull();

  // Seven months of earlier contracts bring the 2-year limit forward to 31 May 2026.
  const earlier = screen.getByRole("spinbutton", { name: "Earlier contracts for the same job, in months (optional)" });
  fireEvent.change(earlier, { target: { value: "6" } });
  expect(screen.queryByText(warning)).toBeNull();
  fireEvent.change(earlier, { target: { value: "7" } });
  expect(screen.getByText(/the limit was reached on May 31, 2026\. The limit counts 7 months of earlier contracts .*\(art\. 148\(6\)\)\./)).toBeTruthy();
  expect(figure()).toBe(euros);

  // A count that is not a whole number is an input error; an uncertain term asks for neither.
  fireEvent.change(earlier, { target: { value: "1.5" } });
  expect(screen.getByText("Enter a whole number from 0 to 600, or leave it empty.")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Kind of term"), { target: { value: "uncertain" } });
  expect(screen.queryByLabelText("Number of renewals (optional)")).toBeNull();
  expect(screen.queryByLabelText("Earlier contracts for the same job, in months (optional)")).toBeNull();
  expect(figure()).toBe(euros);
});
