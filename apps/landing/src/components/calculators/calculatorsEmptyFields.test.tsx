// @vitest-environment jsdom
import type { ComponentType } from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Lang } from "@/lib/i18nLocale";
import BuyVsRentCalculatorComp from "./BuyVsRentCalculatorComp";
import CompoundInterestCalculatorComp from "./CompoundInterestCalculatorComp";
import DebtToIncomeCalculatorComp from "./DebtToIncomeCalculatorComp";
import EarlyRepaymentCalculatorComp from "./EarlyRepaymentCalculatorComp";
import EmergencyFundCalculatorComp from "./EmergencyFundCalculatorComp";
import FireCalculatorComp from "./FireCalculatorComp";
import HouseholdBudgetCalculatorComp from "./HouseholdBudgetCalculatorComp";
import InvestmentReturnCalculatorComp from "./InvestmentReturnCalculatorComp";
import MortgageCalculatorComp from "./MortgageCalculatorComp";
import NetWorthCalculatorComp from "./NetWorthCalculatorComp";
import SavingsGoalCalculatorComp from "./SavingsGoalCalculatorComp";
import SavingsRateCalculatorComp from "./SavingsRateCalculatorComp";
import TermDepositCalculatorComp from "./TermDepositCalculatorComp";

const CALCULATORS: Array<[string, ComponentType<{ locale: Lang }>]> = [
  ["buy versus rent", BuyVsRentCalculatorComp],
  ["compound interest", CompoundInterestCalculatorComp],
  ["debt-to-income", DebtToIncomeCalculatorComp],
  ["early repayment", EarlyRepaymentCalculatorComp],
  ["emergency fund", EmergencyFundCalculatorComp],
  ["FIRE", FireCalculatorComp],
  ["household budget", HouseholdBudgetCalculatorComp],
  ["investment return", InvestmentReturnCalculatorComp],
  ["mortgage", MortgageCalculatorComp],
  ["net worth", NetWorthCalculatorComp],
  ["savings goal", SavingsGoalCalculatorComp],
  ["savings rate", SavingsRateCalculatorComp],
  ["term deposit", TermDepositCalculatorComp],
];

beforeAll(() => {
  // Recharts' ResponsiveContainer measures itself; jsdom has no layout to measure.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

afterEach(cleanup);

/**
 * Every figure on the page, and every attribute and style (chart geometry, bar widths,
 * aria values): a cleared field must never show up as NaN or Infinity.
 */
function expectNoBrokenFigures() {
  expect(document.body.textContent ?? "").not.toMatch(/NaN|Infinity|∞/);
  expect(document.body.innerHTML).not.toMatch(/NaN|Infinity/);
}

describe.each(CALCULATORS)("%s calculator", (_name, Calculator) => {
  it("keeps every cleared field empty, one at a time, without a broken figure", async () => {
    const user = userEvent.setup();
    render(<Calculator locale="en" />);
    const fields = screen.getAllByRole("spinbutton") as HTMLInputElement[];
    expect(fields.length).toBeGreaterThan(0);

    for (const field of fields) {
      const before = field.value;
      await user.clear(field);
      expect(field.value).toBe("");
      expectNoBrokenFigures();
      await user.type(field, before);
    }
  });

  it("keeps all fields empty at once without a broken figure", async () => {
    const user = userEvent.setup();
    render(<Calculator locale="pt" />);
    // Checked as each is cleared: the emergency fund puts its default months back on blur.
    for (const field of screen.getAllByRole("spinbutton") as HTMLInputElement[]) {
      await user.clear(field);
      expect(field.value).toBe("");
    }
    expectNoBrokenFigures();
  });

  it("takes a decimal typed with a comma in every field", async () => {
    const user = userEvent.setup();
    render(<Calculator locale="pt" />);
    for (const field of screen.getAllByRole("spinbutton") as HTMLInputElement[]) {
      await user.clear(field);
      await user.type(field, "3,25");
      expect(field.value).toBe("3,25");
    }
    expectNoBrokenFigures();
  });
});

/** The result figures (not the inputs, which are monospaced too). */
const figures = () =>
  Array.from(document.querySelectorAll("p.font-mono, td.font-mono"), (node) => node.textContent);

/**
 * The empty-state rule: an empty optional amount (a starting amount, a contribution, savings,
 * a line of a list, inflation) counts as 0; an empty rate, period or other required input
 * shows a dash or the calculator's "enter a value" message instead of a result.
 */
describe.each([
  ["compound interest", CompoundInterestCalculatorComp, "Expected annual return"],
  ["compound interest", CompoundInterestCalculatorComp, "Investment period"],
  ["investment return", InvestmentReturnCalculatorComp, "Investment period (years)"],
  ["investment return", InvestmentReturnCalculatorComp, "Initial investment"],
  ["savings rate", SavingsRateCalculatorComp, "Monthly income (after tax)"],
] as const)("%s calculator with the required field %j cleared", (_name, Calculator, label) => {
  it("shows dashes instead of a result", async () => {
    const user = userEvent.setup();
    render(<Calculator locale="en" />);
    await user.clear(screen.getByRole("spinbutton", { name: label }));
    expect(figures().length).toBeGreaterThan(0);
    expect(figures().every((figure) => figure === "—")).toBe(true);
  });
});

describe("compound interest calculator", () => {
  it("asks for the return and the period while one is empty", async () => {
    const user = userEvent.setup();
    render(<CompoundInterestCalculatorComp locale="en" />);
    await user.clear(screen.getByRole("spinbutton", { name: "Investment period" }));
    await user.tab();
    expect((screen.getByRole("spinbutton", { name: "Investment period" }) as HTMLInputElement).value).toBe("");
    expect(
      screen.getByText("Enter an expected annual return and an investment period to see it grow."),
    ).toBeTruthy();
    expect(
      screen.getByText("Enter a return, a period and a contribution to compare to see the difference."),
    ).toBeTruthy();
  });

  it.each(["Initial investment", "Monthly contribution", "Expected annual inflation"])(
    "counts an empty %s as 0",
    async (label) => {
      const user = userEvent.setup();
      render(<CompoundInterestCalculatorComp locale="en" />);
      const field = screen.queryByRole("spinbutton", { name: label });
      if (!field) throw new Error(`No field labelled ${label}`);
      await user.clear(field);
      expect(figures().some((figure) => figure !== "—")).toBe(true);
    },
  );

  it("shows dashes in the comparison column while the comparison contribution is empty", async () => {
    const user = userEvent.setup();
    render(<CompoundInterestCalculatorComp locale="en" />);
    const comparison = screen.getByRole("spinbutton", { name: "Monthly contribution to compare" });
    await user.clear(comparison);
    const table = screen.getByRole("table", { name: "Compare another monthly contribution" });
    const rows = within(table).getAllByRole("row").slice(1);
    for (const row of rows) {
      const [current, other, difference] = within(row).getAllByRole("cell").map((cell) => cell.textContent);
      expect(current).not.toBe("—");
      expect(other).toBe("—");
      expect(difference).toBe("—");
    }
  });
});

describe("mortgage calculator with the interest rate cleared", () => {
  it("asks for the rate instead of computing at 0%", async () => {
    const user = userEvent.setup();
    render(<MortgageCalculatorComp locale="en" />);
    await user.clear(screen.getByRole("spinbutton", { name: "Interest rate" }));
    expect(screen.getByText("Enter the interest rate.")).toBeTruthy();
    expect(figures()).toEqual([]);
  });
});

describe.each(["Expected real return a year", "Safe withdrawal rate"])(
  "FIRE calculator with %j cleared",
  (label) => {
    it("asks for both rates instead of using 0% or the default", async () => {
      const user = userEvent.setup();
      render(<FireCalculatorComp locale="en" />);
      await user.clear(screen.getByRole("spinbutton", { name: label }));
      expect(
        screen.getByText("Enter a real return and a withdrawal rate to see your FIRE number."),
      ).toBeTruthy();
    });
  },
);

describe.each([
  "Mortgage interest rate",
  "Home value growth a year",
  "Rent increase a year",
  "Investment return a year",
])("buy versus rent calculator with %j cleared", (label) => {
  it("asks for a value instead of reading the cleared rate as 0%", async () => {
    const user = userEvent.setup();
    render(<BuyVsRentCalculatorComp locale="en" />);
    const field = screen.getByRole("spinbutton", { name: label });
    await user.clear(field);
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText("Enter a value.")).toBeTruthy();
    expect(
      screen.getByText("The comparison appears once every field has a valid value."),
    ).toBeTruthy();
    expect(figures()).toEqual([]);
  });
});

describe.each(["Down payment", "Monthly rent", "Purchase costs", "Ownership costs a year", "Selling costs at the end"])(
  "buy versus rent calculator with %j cleared",
  (label) => {
    it("counts the empty amount as 0", async () => {
      const user = userEvent.setup();
      render(<BuyVsRentCalculatorComp locale="en" />);
      await user.clear(screen.getByRole("spinbutton", { name: label }));
      expect(screen.queryByText("Enter a value.")).toBeNull();
      expect(figures().length).toBeGreaterThan(0);
    });
  },
);

describe("savings goal calculator with the annual return cleared", () => {
  it("asks for the return instead of reading it as 0%", async () => {
    const user = userEvent.setup();
    render(<SavingsGoalCalculatorComp locale="en" />);
    await user.clear(screen.getByRole("spinbutton", { name: "Expected annual return" }));
    expect(screen.getByText("Enter an expected annual return, 0% or more.")).toBeTruthy();
  });
});

describe("net worth calculator with every field cleared", () => {
  it("counts every empty line as 0", async () => {
    const user = userEvent.setup();
    render(<NetWorthCalculatorComp locale="en" />);
    for (const field of screen.getAllByRole("spinbutton")) await user.clear(field);
    expect(figures()).toEqual(["€0", "€0", "€0"]);
  });
});

describe("debt-to-income payment rows", () => {
  it("leave a cleared amount empty", async () => {
    const user = userEvent.setup();
    render(<DebtToIncomeCalculatorComp locale="en" />);
    const list = screen.getByRole("list");
    const [amount] = within(list).getAllByRole("spinbutton") as HTMLInputElement[];
    await user.clear(amount);
    expect(amount.value).toBe("");
    await user.type(amount, "12.5");
    expect(amount.value).toBe("12.5");
  });
});

describe.each([
  ["Amount deposited", "Enter the amount you deposit."],
  ["Gross annual interest rate", "Enter the rate, or 0 for none."],
  ["Term", "Enter a term of at least 1 month."],
] as const)("term deposit calculator with the required field %j cleared", (label, message) => {
  it("asks for a value instead of a result", async () => {
    const user = userEvent.setup();
    render(<TermDepositCalculatorComp locale="en" />);
    await user.clear(screen.getByRole("spinbutton", { name: label }));
    expect(screen.getByText(message)).toBeTruthy();
    expect(screen.getByText("The result appears once every field has a valid value.")).toBeTruthy();
    expect(figures()).toEqual([]);
  });
});

describe("term deposit calculator with the tax cleared", () => {
  it("counts an empty tax rate as 0%", async () => {
    const user = userEvent.setup();
    render(<TermDepositCalculatorComp locale="en" />);
    const before = figures();
    await user.clear(screen.getByRole("spinbutton", { name: "Tax withheld on interest" }));
    expect(figures()).toEqual(before);
    expect(figures()).toContain("€0.00");
  });
});

describe("early repayment calculator", () => {
  it("asks for the rate instead of computing at 0%", async () => {
    const user = userEvent.setup();
    render(<EarlyRepaymentCalculatorComp locale="en" />);
    await user.clear(screen.getByRole("spinbutton", { name: "Interest rate" }));
    expect(screen.getByText("Enter the interest rate.")).toBeTruthy();
    expect(figures()).toEqual([]);
  });

  it("asks for the time left when both term fields are empty", async () => {
    const user = userEvent.setup();
    render(<EarlyRepaymentCalculatorComp locale="en" />);
    await user.clear(screen.getByRole("spinbutton", { name: "Years" }));
    await user.clear(screen.getByRole("spinbutton", { name: "Months" }));
    expect(screen.getByText("Enter the time left, at least one month.")).toBeTruthy();
    expect(figures()).toEqual([]);
  });

  it("reads an empty months field as 0 when years are given", async () => {
    const user = userEvent.setup();
    render(<EarlyRepaymentCalculatorComp locale="en" />);
    await user.clear(screen.getByRole("spinbutton", { name: "Months" }));
    expect(figures().length).toBeGreaterThan(0);
  });

  it("asks for the balance, since a loan needs one", async () => {
    const user = userEvent.setup();
    render(<EarlyRepaymentCalculatorComp locale="en" />);
    await user.clear(screen.getByRole("spinbutton", { name: "Balance still owed" }));
    expect(screen.getByText("Enter the balance you still owe.")).toBeTruthy();
    expect(figures()).toEqual([]);
  });

  it("counts an empty repayment as nothing repaid", async () => {
    const user = userEvent.setup();
    render(<EarlyRepaymentCalculatorComp locale="en" />);
    await user.clear(screen.getByRole("spinbutton", { name: "Lump sum you repay now" }));
    expect(
      screen.getByText(
        "Enter a lump sum to see what it saves. With nothing repaid, the loan stays as it is.",
      ),
    ).toBeTruthy();
  });

  it("counts an empty fee as none", async () => {
    const user = userEvent.setup();
    render(<EarlyRepaymentCalculatorComp locale="en" />);
    await user.clear(screen.getByRole("spinbutton", { name: "Early repayment fee" }));
    expect(figures().length).toBeGreaterThan(0);
    expect(screen.queryByText(/Enter a fee/)).toBeNull();
  });
});
