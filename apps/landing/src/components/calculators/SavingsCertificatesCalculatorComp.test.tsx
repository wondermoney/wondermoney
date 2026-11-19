// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const pushGtmEvent = vi.fn();
vi.mock("@/lib/gtm", () => ({
  pushGtmEvent: (payload: unknown) => pushGtmEvent(payload),
  getPageType: () => "tools/savings-certificates-calculator",
}));

const { default: SavingsCertificatesCalculatorComp } = await import("./SavingsCertificatesCalculatorComp");

afterEach(() => {
  cleanup();
  pushGtmEvent.mockClear();
});

it("recalculates, validates, and tracks one valid edit with metadata only", () => {
  render(<SavingsCertificatesCalculatorComp locale="en" />);
  const initial = screen.getByText(/^€1[01],\d{3}\.\d\d$/, { selector: "#savingsCertificates-finalValue" }).textContent;
  expect(pushGtmEvent).not.toHaveBeenCalled();

  const rate = screen.getByRole("spinbutton", { name: "Base rate (assumption)" });
  fireEvent.change(rate, { target: { value: "3" } });
  expect(rate.getAttribute("aria-invalid")).toBe("true");
  expect(document.querySelector("#savingsCertificates-finalValue")).toBeNull();
  expect(pushGtmEvent).not.toHaveBeenCalled();

  fireEvent.change(rate, { target: { value: "1" } });
  const lower = document.querySelector("#savingsCertificates-finalValue")?.textContent;
  expect(lower).not.toBe(initial);
  expect(pushGtmEvent).toHaveBeenCalledExactlyOnceWith({
    event: "tool_used", tool: "savings_certificates", page_type: "tools/savings-certificates-calculator",
  });
});
