// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const pushGtmEvent = vi.fn();
vi.mock("@/lib/gtm", () => ({
  pushGtmEvent: (payload: unknown) => pushGtmEvent(payload),
  getPageType: () => "tools/portugal-net-salary-calculator",
}));

const { default: NetSalaryCalculatorComp } = await import("./NetSalaryCalculatorComp");

afterEach(() => {
  cleanup();
  pushGtmEvent.mockClear();
});

it("shows the example, validates, and tracks one edit with metadata only", () => {
  render(<NetSalaryCalculatorComp locale="en" />);
  expect(screen.getByText("€1,302.13")).toBeTruthy();
  expect(pushGtmEvent).not.toHaveBeenCalled();

  const gross = screen.getByRole("spinbutton", { name: "Gross monthly salary" });
  fireEvent.change(gross, { target: { value: "" } });
  expect(gross.getAttribute("aria-invalid")).toBe("true");
  expect(screen.queryByText("€1,302.13")).toBeNull();
  expect(pushGtmEvent).not.toHaveBeenCalled();

  fireEvent.change(gross, { target: { value: "1500" } });
  fireEvent.change(screen.getByLabelText("Allowances"), { target: { value: "twelfths" } });
  expect(screen.getByText("€1,464.38")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Region"), { target: { value: "madeira" } });
  expect(pushGtmEvent).toHaveBeenCalledExactlyOnceWith({
    event: "tool_used", tool: "net_salary", page_type: "tools/portugal-net-salary-calculator",
  });
});
