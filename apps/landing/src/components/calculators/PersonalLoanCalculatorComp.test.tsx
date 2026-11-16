// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const pushGtmEvent = vi.fn();
vi.mock("@/lib/gtm", () => ({
  pushGtmEvent: (payload: unknown) => pushGtmEvent(payload),
  getPageType: () => "tools/personal-loan-calculator",
}));

const { default: PersonalLoanCalculatorComp } = await import("./PersonalLoanCalculatorComp");

afterEach(() => {
  cleanup();
  pushGtmEvent.mockClear();
});

async function enter(label: string, value: string) {
  const user = userEvent.setup();
  const field = screen.getByRole("spinbutton", { name: label });
  await user.clear(field);
  await user.type(field, value);
}

describe("personal loan calculator", () => {
  it("starts from the worked example with no fees", () => {
    render(<PersonalLoanCalculatorComp locale="en" />);

    expect(screen.getByText("€202.76")).toBeTruthy();
    expect(screen.getByText("Estimated APR, fees included")).toBeTruthy();
    expect(screen.getByText("8.30%")).toBeTruthy();
    expect(screen.queryByText(/for the loan plus/)).toBeNull();
    expect(screen.getByText(/This is an estimate, not a loan offer/)).toBeTruthy();
  });

  it("adds the fees to the payment, the totals and the APR", async () => {
    render(<PersonalLoanCalculatorComp locale="en" />);
    await enter("Upfront fees", "250");
    await enter("Monthly fees and insurance", "5");

    expect(screen.getByText("€207.76")).toBeTruthy();
    expect(screen.getByText("€202.76 for the loan plus €5.00 in fees.")).toBeTruthy();
    expect(screen.getByText("You receive €9,750.00 once the upfront fees are taken off.")).toBeTruthy();
    expect(screen.getByText("10.61%")).toBeTruthy();
    expect(screen.getByText("€550.00")).toBeTruthy();
  });

  it("shows the monthly schedule on demand, with totals that match the result", async () => {
    const user = userEvent.setup();
    render(<PersonalLoanCalculatorComp locale="en" />);
    await enter("Term", "12");
    await enter("Monthly fees and insurance", "2");

    expect(screen.queryByRole("table")).toBeNull();
    const toggle = screen.getByRole("button", { name: "Show the monthly schedule" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    await user.click(toggle);

    const table = screen.getByRole("table", { name: "Monthly schedule" });
    const rows = within(table).getAllByRole("row");
    // Header, 12 months, total.
    expect(rows).toHaveLength(14);
    expect(within(rows[0]).getByText("Fees")).toBeTruthy();
    const total = within(rows[13]).getAllByRole("cell").map((cell) => cell.textContent);
    expect(total[1]).toBe("€10,000.00");

    await user.click(screen.getByRole("button", { name: "Hide the monthly schedule" }));
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("names a cap instead of printing an APR in the thousands", async () => {
    render(<PersonalLoanCalculatorComp locale="en" />);
    await enter("Amount borrowed", "100");
    await enter("Term", "6");
    await enter("Monthly fees and insurance", "500");

    expect(screen.getByText("over 1,000%")).toBeTruthy();
  });

  it("explains a term outside 6 to 120 months", async () => {
    render(<PersonalLoanCalculatorComp locale="en" />);
    await enter("Term", "121");

    expect(screen.getByText("Enter a term of up to 120 months.")).toBeTruthy();
    expect(screen.getByText("Your result appears once every field has a valid value.")).toBeTruthy();
  });

  it("limits the upfront fees to half the amount", async () => {
    render(<PersonalLoanCalculatorComp locale="en" />);
    await enter("Upfront fees", "6000");

    expect(screen.getByText("Enter upfront fees up to €5,000.00, half the amount borrowed.")).toBeTruthy();
  });

  it("reports use once, on the first edit, with no amounts", async () => {
    render(<PersonalLoanCalculatorComp locale="en" />);
    expect(pushGtmEvent).not.toHaveBeenCalled();
    await enter("Amount borrowed", "12000");
    await enter("Interest rate", "7");

    expect(pushGtmEvent).toHaveBeenCalledTimes(1);
    expect(pushGtmEvent).toHaveBeenCalledWith({
      event: "tool_used",
      tool: "personal_loan",
      page_type: "tools/personal-loan-calculator",
    });
  });
});
