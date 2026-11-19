// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const pushGtmEvent = vi.fn();
vi.mock("@/lib/gtm", () => ({
  pushGtmEvent: (payload: unknown) => pushGtmEvent(payload),
  getPageType: () => "tools/portugal-irs-withholding-tables",
}));

const { default: WithholdingTablesComp } = await import("./WithholdingTablesComp");

afterEach(() => {
  cleanup();
  pushGtmEvent.mockClear();
});

it("highlights the row, switches table and region, and tracks one edit with metadata only", () => {
  render(<WithholdingTablesComp locale="en" />);
  expect(screen.getByText("€168.17")).toBeTruthy();
  expect(document.querySelector("tr[aria-current='true']")?.textContent).toContain("24.10%");
  expect(pushGtmEvent).not.toHaveBeenCalled();

  fireEvent.change(screen.getByLabelText("Withholding table"), { target: { value: "III" } });
  expect(screen.getByText("€94.18")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Region"), { target: { value: "madeira" } });
  expect(document.querySelector("tr[aria-current='true']")).toBeTruthy();
  fireEvent.change(screen.getByRole("spinbutton", { name: "Monthly remuneration" }), { target: { value: "" } });
  expect(document.querySelector("tr[aria-current='true']")).toBeNull();
  expect(pushGtmEvent).toHaveBeenCalledExactlyOnceWith({
    event: "tool_used", tool: "withholding_tables", page_type: "tools/portugal-irs-withholding-tables",
  });
});

it("says a negative remuneration must be zero or more, and a too large one gives the maximum", () => {
  render(<WithholdingTablesComp locale="en" />);
  const field = screen.getByRole("spinbutton", { name: "Monthly remuneration" });
  fireEvent.change(field, { target: { value: "-5" } });
  expect(screen.getByText("Enter an amount of zero or more.")).toBeTruthy();
  expect(screen.queryByText(/up to/)).toBeNull();
  fireEvent.change(field, { target: { value: "150000" } });
  expect(screen.getByText(/Enter an amount up to/)).toBeTruthy();
});
