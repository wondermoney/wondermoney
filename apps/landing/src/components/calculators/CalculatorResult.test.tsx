// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import CalculatorResult from "./CalculatorResult";

afterEach(cleanup);

describe("CalculatorResult", () => {
  it("sets figures in the financial face and text values in the body face", () => {
    render(
      <CalculatorResult
        items={[
          { label: "Monthly benefit", value: "1 000,00 €", highlight: true },
          { label: "Daily benefit", value: "33,33 €" },
          { label: "Duration", value: "480 days (about 16 months)", text: true },
          { label: "Answer in words", value: "Never", highlight: true, text: true },
        ]}
      />,
    );

    expect(screen.getByText("1 000,00 €").className).toContain("font-mono");
    expect(screen.getByText("33,33 €").className).toContain("font-mono");
    const duration = screen.getByText("480 days (about 16 months)");
    expect(duration.className).toContain("font-sans");
    expect(duration.className).not.toContain("font-mono");
    const never = screen.getByText("Never");
    expect(never.className).toContain("font-sans");
    expect(never.className).not.toContain("font-mono");
  });
});
