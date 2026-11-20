// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { BROKER_FEES, SCENARIO_PROFILES, compareBrokers } from "@/lib/calculators/brokerFees";

const pushGtmEvent = vi.fn();
vi.mock("@/lib/gtm", () => ({
  pushGtmEvent: (payload: unknown) => pushGtmEvent(payload),
  getPageType: () => "tools/x",
}));

const { default: BrokerFeesComp } = await import("./BrokerFeesComp");

afterEach(() => {
  cleanup();
  pushGtmEvent.mockClear();
  vi.useRealTimers();
});

const results = () => within(screen.getByRole("heading", { name: "Cost per broker, cheapest first" }).parentElement as HTMLElement);

it("shows the review date, every broker with its source, and the monthly ETF profile sorted by cost", () => {
  vi.useFakeTimers({ now: new Date("2026-11-21T10:00:00Z"), toFake: ["Date"] });
  render(<BrokerFeesComp locale="en" />);
  expect(screen.getByText("Fees checked on 20 Nov 2026")).toBeTruthy();
  expect(screen.queryByText("This review may be out of date")).toBeNull();
  for (const broker of BROKER_FEES) {
    expect(screen.getAllByText(broker.name).length).toBeGreaterThan(0);
    for (const source of broker.sources) {
      expect(document.querySelector(`a[href="${source.url}"]`)).toBeTruthy();
    }
  }
  const items = results().getAllByRole("listitem").filter((item) => item.parentElement?.tagName === "OL");
  expect(items).toHaveLength(BROKER_FEES.length);
  const expected = compareBrokers(SCENARIO_PROFILES.monthlyEtf);
  expect(items[0].textContent).toContain(expected[0].broker.name);
  expect(items[items.length - 1].textContent).toContain(expected[expected.length - 1].broker.name);
  expect(pushGtmEvent).not.toHaveBeenCalled();
});

it("warns when the review is more than four months old", () => {
  vi.useFakeTimers({ now: new Date("2027-05-01T10:00:00Z"), toFake: ["Date"] });
  render(<BrokerFeesComp locale="en" />);
  expect(screen.getByText("This review may be out of date")).toBeTruthy();
});

it("switches profile, reports one use without data and shows the calculation", () => {
  render(<BrokerFeesComp locale="en" />);
  fireEvent.click(screen.getByLabelText(/Occasional stock buyer/));
  expect(document.body.textContent).toContain("Currency conversion (0.03% of €6,000): €1.80");
  fireEvent.click(screen.getByLabelText(/Larger portfolio/));
  expect(pushGtmEvent).toHaveBeenCalledTimes(1);
  expect(pushGtmEvent).toHaveBeenCalledWith({ event: "tool_used", tool: "broker_fees", page_type: "tools/x" });
  expect(JSON.stringify(pushGtmEvent.mock.calls)).not.toMatch(/50000|2500|largePortfolio/);
});

it("gives a clear message for empty or out-of-range input and zero for no orders", () => {
  render(<BrokerFeesComp locale="en" />);
  fireEvent.change(screen.getByLabelText("Buy orders a year"), { target: { value: "" } });
  expect(screen.getByText("Correct the fields above to see the estimate.")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Buy orders a year"), { target: { value: "0" } });
  fireEvent.change(screen.getByLabelText("Value held"), { target: { value: "0" } });
  const items = results().getAllByRole("listitem").filter((item) => item.parentElement?.tagName === "OL");
  expect(items).toHaveLength(BROKER_FEES.length);
  for (const item of items) expect(item.textContent).toContain("€0.00");
  fireEvent.change(screen.getByLabelText("Value held"), { target: { value: "1000000000" } });
  expect(screen.getByText("Correct the fields above to see the estimate.")).toBeTruthy();
});

it("renders in Portuguese without the English copy", () => {
  render(<BrokerFeesComp locale="pt" />);
  act(() => {});
  expect(document.body.textContent).not.toContain("Fees checked on");
  expect(document.body.textContent).toContain("Comissões verificadas a");
});
