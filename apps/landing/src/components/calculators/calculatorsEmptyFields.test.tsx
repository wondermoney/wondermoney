// @vitest-environment jsdom
import type { ComponentType } from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Lang } from "@/lib/i18nLocale";
import CompoundInterestCalculatorComp from "./CompoundInterestCalculatorComp";
import DebtToIncomeCalculatorComp from "./DebtToIncomeCalculatorComp";
import EmergencyFundCalculatorComp from "./EmergencyFundCalculatorComp";
import FireCalculatorComp from "./FireCalculatorComp";
import InvestmentReturnCalculatorComp from "./InvestmentReturnCalculatorComp";
import MortgageCalculatorComp from "./MortgageCalculatorComp";
import NetWorthCalculatorComp from "./NetWorthCalculatorComp";
import SavingsRateCalculatorComp from "./SavingsRateCalculatorComp";

const CALCULATORS: Array<[string, ComponentType<{ locale: Lang }>]> = [
  ["compound interest", CompoundInterestCalculatorComp],
  ["debt-to-income", DebtToIncomeCalculatorComp],
  ["emergency fund", EmergencyFundCalculatorComp],
  ["FIRE", FireCalculatorComp],
  ["investment return", InvestmentReturnCalculatorComp],
  ["mortgage", MortgageCalculatorComp],
  ["net worth", NetWorthCalculatorComp],
  ["savings rate", SavingsRateCalculatorComp],
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

/** Every figure on the page: a cleared field must never show up as NaN or Infinity. */
function expectNoBrokenFigures() {
  const text = document.body.textContent ?? "";
  expect(text).not.toMatch(/NaN|Infinity|∞/);
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

describe.each([
  ["compound interest", CompoundInterestCalculatorComp, "Expected annual return"],
  ["investment return", InvestmentReturnCalculatorComp, "Investment period (years)"],
  ["savings rate", SavingsRateCalculatorComp, "Monthly income (after tax)"],
] as const)("%s calculator with a needed field cleared", (_name, Calculator, label) => {
  it("shows dashes instead of a result", async () => {
    const user = userEvent.setup();
    render(<Calculator locale="en" />);
    await user.clear(screen.getByRole("spinbutton", { name: label }));
    // CalculatorResult's figures: every one is a dash, none a result for 0.
    const figures = Array.from(document.querySelectorAll("p.font-mono"), (node) => node.textContent);
    expect(figures.length).toBeGreaterThan(0);
    expect(figures.every((figure) => figure === "—")).toBe(true);
  });
});

describe("net worth calculator with every field cleared", () => {
  it("shows dashes instead of a net worth of 0", async () => {
    const user = userEvent.setup();
    render(<NetWorthCalculatorComp locale="en" />);
    for (const field of screen.getAllByRole("spinbutton")) await user.clear(field);
    const figures = Array.from(document.querySelectorAll("p.font-mono"), (node) => node.textContent);
    expect(figures).toEqual(["—", "—", "—"]);
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
