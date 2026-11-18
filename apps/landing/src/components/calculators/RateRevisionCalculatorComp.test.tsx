// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { getPageType, pushGtmEvent } from "@/lib/gtm";
import RateRevisionCalculatorComp from "./RateRevisionCalculatorComp";

vi.mock("@/lib/gtm", () => ({
  getPageType: vi.fn(() => "tools/variable-rate-payment-calculator"),
  pushGtmEvent: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("counts the first valid edited calculation once, without the input values", async () => {
  const user = userEvent.setup();
  render(<RateRevisionCalculatorComp locale="en" />);

  const spread = screen.getByRole("spinbutton", { name: "Spread" });
  expect(pushGtmEvent).not.toHaveBeenCalled();
  await user.clear(spread);
  expect(pushGtmEvent).not.toHaveBeenCalled();

  await user.type(spread, "2");
  expect(pushGtmEvent).toHaveBeenCalledExactlyOnceWith({
    event: "tool_used",
    tool: "rate_revision",
    page_type: getPageType(),
  });

  await user.click(screen.getByRole("button", { name: "+3 points" }));
  expect(pushGtmEvent).toHaveBeenCalledTimes(1);
});
