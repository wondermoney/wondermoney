// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { pushGtmEvent } from "@/lib/gtm";
import IndexProjectionCalculator from "./IndexProjectionCalculator";

vi.mock("@/lib/gtm", () => ({
  getPageType: () => "tools/investment-return-calculator",
  pushGtmEvent: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("updates the projection and records only the first edited valid result", async () => {
  const user = userEvent.setup();
  render(<IndexProjectionCalculator locale="en" />);

  const result = () => screen.getByText("Projected value after fees").nextElementSibling?.textContent;
  const initial = result();
  const rate = screen.getByRole("spinbutton", { name: "Assumed annual return before fees" });
  const fee = screen.getByRole("spinbutton", { name: "Annual fund fee" });
  expect(pushGtmEvent).not.toHaveBeenCalled();

  await user.clear(rate);
  expect(screen.queryByText("Projected value after fees")).toBeNull();
  expect(pushGtmEvent).not.toHaveBeenCalled();

  await user.type(rate, "-5");
  expect(result()).toEqual(expect.any(String));
  expect(result()).not.toEqual(initial);
  expect(pushGtmEvent).toHaveBeenCalledExactlyOnceWith({
    event: "tool_used",
    tool: "investment_return",
    mode: "index_projection",
    page_type: "tools/investment-return-calculator",
  });

  const withFee = result();
  await user.clear(fee);
  await user.type(fee, "0");
  expect(result()).not.toEqual(withFee);
  expect(pushGtmEvent).toHaveBeenCalledTimes(1);
});
