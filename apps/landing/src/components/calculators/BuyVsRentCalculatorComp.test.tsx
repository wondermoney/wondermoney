// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import BuyVsRentCalculatorComp from "./BuyVsRentCalculatorComp";

beforeAll(() => {
  // Recharts' ResponsiveContainer measures itself; jsdom has no layout to measure.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

afterEach(cleanup);

async function enter(label: string, value: string) {
  const user = userEvent.setup();
  const field = screen.getByRole("spinbutton", { name: label });
  await user.clear(field);
  await user.type(field, value);
}

describe("buy versus rent calculator", () => {
  it("states the break-even year when buying ends ahead", () => {
    render(<BuyVsRentCalculatorComp locale="en" />);

    expect(screen.getByText("Buying comes out ahead by")).toBeTruthy();
    expect(screen.getByText("Buying pulls ahead at the end of year 9.")).toBeTruthy();
  });

  it("says buying falls behind again when it pulls ahead but ends behind", async () => {
    render(<BuyVsRentCalculatorComp locale="en" />);
    await enter("Down payment", "30000");
    await enter("Mortgage interest rate", "1");
    await enter("Mortgage term", "15");
    await enter("Ownership costs a year", "0.5");
    await enter("Home value growth a year", "0");
    await enter("Monthly rent", "1000");
    await enter("Rent increase a year", "1");
    await enter("Years to compare", "20");

    expect(screen.getByText("Renting comes out ahead by")).toBeTruthy();
    expect(
      screen.getByText("Buying is ahead from year 11 but falls behind again by year 15."),
    ).toBeTruthy();
    expect(screen.queryByText(/pulls ahead at the end of year/)).toBeNull();
  });

  it("says buying never pulls ahead when it stays behind", async () => {
    render(<BuyVsRentCalculatorComp locale="en" />);
    await enter("Home value growth a year", "-5");

    expect(screen.getByText("Buying does not pull ahead by the end of year 10.")).toBeTruthy();
  });
});
