// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CalculatorInput from "./CalculatorInput";

afterEach(cleanup);

type HarnessProps = {
  initial?: number;
  /** What the parent stores for a value it receives, as a calculator that refuses negatives does. */
  store?: (value: number) => number;
  /** What the parent sets when the field loses focus, as the emergency fund's clamp does. */
  onBlurSet?: (value: number) => number;
  presets?: number[];
  min?: number;
  max?: number;
  step?: number;
};

/** A parent holding the value as a calculator does; `received` is every number it was given. */
function setup({ initial = 0, store = (value) => value, onBlurSet, presets = [], ...bounds }: HarnessProps = {}) {
  const received: number[] = [];

  function Harness() {
    const [value, setValue] = useState(initial);
    return (
      <div onBlur={onBlurSet ? () => setValue(onBlurSet(value)) : undefined}>
        <CalculatorInput
          id="rate"
          label="Rate"
          value={value}
          onChange={(next) => {
            received.push(next);
            setValue(store(next));
          }}
          {...bounds}
        />
        {presets.map((preset) => (
          <button key={preset} type="button" onClick={() => setValue(preset)}>
            {`Preset ${preset}`}
          </button>
        ))}
        <output data-testid="parent">{String(value)}</output>
      </div>
    );
  }

  render(<Harness />);
  const input = screen.getByRole("spinbutton", { name: "Rate" }) as HTMLInputElement;
  return { input, received, user: userEvent.setup() };
}

const parentValue = () => screen.getByTestId("parent").textContent;

describe("CalculatorInput", () => {
  it("shows the starting value", () => {
    const { input } = setup({ initial: 3.5 });
    expect(input.value).toBe("3.5");
  });

  it("leaves a cleared field empty and gives the parent NaN", async () => {
    const { input, received, user } = setup({ initial: 7 });
    await user.clear(input);
    expect(input.value).toBe("");
    expect(received).toEqual([Number.NaN]);
    expect(parentValue()).toBe("NaN");
  });

  it("keeps a trailing dot while the parent gets the number so far", async () => {
    const { input, received, user } = setup({ initial: 7 });
    await user.clear(input);
    await user.type(input, "3.");
    expect(input.value).toBe("3.");
    expect(received).toEqual([Number.NaN, 3]);
  });

  it("types 3.25 key by key", async () => {
    const { input, received, user } = setup({ initial: 7 });
    await user.clear(input);
    await user.type(input, "3.25");
    expect(input.value).toBe("3.25");
    expect(received).toEqual([Number.NaN, 3, 3.2, 3.25]);
    expect(parentValue()).toBe("3.25");
  });

  it("takes a comma as the decimal separator", async () => {
    const { input, received, user } = setup({ initial: 7 });
    await user.clear(input);
    await user.type(input, "3,25");
    expect(input.value).toBe("3,25");
    expect(received.at(-1)).toBe(3.25);
  });

  it("keeps a lone minus sign and gives the parent NaN", async () => {
    const { input, received, user } = setup({ initial: 7 });
    await user.clear(input);
    await user.type(input, "-");
    expect(input.value).toBe("-");
    expect(received).toEqual([Number.NaN]);
    expect(parentValue()).toBe("NaN");
  });

  it("types -50 key by key", async () => {
    const { input, received, user } = setup({ initial: 0 });
    await user.clear(input);
    await user.type(input, "-50");
    expect(input.value).toBe("-50");
    expect(received.at(-1)).toBe(-50);
  });

  it("refuses characters that cannot be part of a number", async () => {
    const { input, user } = setup({ initial: 7 });
    await user.clear(input);
    await user.type(input, "3a.b2");
    expect(input.value).toBe("3.2");
  });

  it("shows what the parent stores when it differs from what was typed", async () => {
    const { input, user } = setup({ initial: 100, store: (value) => (value < 0 ? 0 : value) });
    await user.clear(input);
    await user.type(input, "-5");
    expect(input.value).toBe("0");
    expect(parentValue()).toBe("0");
  });

  it("shows a value a preset button sets", async () => {
    const { input, user } = setup({ initial: 6, presets: [3, 12] });
    await user.clear(input);
    await user.type(input, "4,");
    await user.click(screen.getByRole("button", { name: "Preset 12" }));
    expect(input.value).toBe("12");
    await user.click(screen.getByRole("button", { name: "Preset 3" }));
    expect(input.value).toBe("3");
  });

  it("shows a value the parent clamps on blur", async () => {
    const { input, user } = setup({ initial: 6, onBlurSet: (value) => Math.min(24, Math.max(1, value)) });
    await user.clear(input);
    await user.type(input, "30");
    await user.tab();
    expect(input.value).toBe("24");
  });

  it("tidies a trailing separator and a lone sign on blur", async () => {
    const { input, user } = setup({ initial: 6 });
    await user.clear(input);
    await user.type(input, "3,");
    await user.tab();
    expect(input.value).toBe("3");

    await user.clear(input);
    await user.type(input, "-");
    await user.tab();
    expect(input.value).toBe("");
  });

  it("keeps a comma on blur", async () => {
    const { input, user } = setup({ initial: 6 });
    await user.clear(input);
    await user.type(input, "3,50");
    await user.tab();
    expect(input.value).toBe("3,5");
  });

  it("steps with the arrow keys within min and max", async () => {
    const { input, received, user } = setup({ initial: 29, min: 0, max: 30, step: 0.5 });
    await user.click(input);
    await user.keyboard("{ArrowUp}");
    expect(input.value).toBe("29.5");
    await user.keyboard("{ArrowUp}{ArrowUp}");
    expect(input.value).toBe("30");
    await user.keyboard("{ArrowDown}");
    expect(input.value).toBe("29.5");
    expect(received).toEqual([29.5, 30, 29.5]);
  });

  it("exposes the number and its bounds to assistive technology", async () => {
    const { input, user } = setup({ initial: 4, min: 0, max: 30 });
    expect(input.getAttribute("aria-valuenow")).toBe("4");
    expect(input.getAttribute("aria-valuemin")).toBe("0");
    expect(input.getAttribute("aria-valuemax")).toBe("30");
    expect(input.getAttribute("inputmode")).toBe("decimal");
    await user.clear(input);
    expect(input.hasAttribute("aria-valuenow")).toBe(false);
  });

  it("offers the full keyboard where negative numbers are allowed", () => {
    const { input } = setup({ initial: 4, min: -10 });
    expect(input.getAttribute("inputmode")).toBe("text");
  });
});
