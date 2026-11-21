// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Input } from "./input";
import { Select } from "./select";

afterEach(cleanup);

const classesOf = (element: Element) => element.className.split(/\s+/);

const BOX = ["h-10", "rounded-md", "border", "border-input", "bg-background", "text-sm"];
const FOCUS_RING = [
  "focus-visible:outline-none",
  "focus-visible:ring-2",
  "focus-visible:ring-ring",
  "focus-visible:ring-offset-2",
];
const ERROR_BORDER = "aria-[invalid=true]:border-destructive-text";

describe("Input", () => {
  it("draws the select's box: height, corner, stroke and focus ring", () => {
    // Given a text field and a dropdown side by side
    render(
      <>
        <Input aria-label="Name" />
        <Select aria-label="Fuel">
          <option>Petrol</option>
        </Select>
      </>,
    );

    // When
    const input = classesOf(screen.getByLabelText("Name"));
    const select = classesOf(screen.getByLabelText("Fuel"));

    // Then both carry the same 40px, 6px-radius box and the same instant ring
    for (const classes of [input, select]) {
      expect(classes).toEqual(expect.arrayContaining([...BOX, ...FOCUS_RING]));
      expect(classes).not.toContain("rounded-lg");
    }
  });

  it("draws the error border on an input and a select marked aria-invalid", () => {
    // Given
    render(
      <>
        <Input aria-label="Start date" type="date" aria-invalid />
        <Select aria-label="Region" aria-invalid>
          <option>Mainland</option>
        </Select>
      </>,
    );

    // Then the variant is on both, and the attribute it keys on is set
    for (const name of ["Start date", "Region"]) {
      const field = screen.getByLabelText(name);
      expect(classesOf(field)).toContain(ERROR_BORDER);
      expect(field.getAttribute("aria-invalid")).toBe("true");
    }
  });

  it("passes the id, value, onChange, inputMode, min, max and step through to the native input", () => {
    // Given
    const onChange = vi.fn();
    render(
      <>
        <label htmlFor="years">Years</label>
        <Input id="years" type="number" inputMode="numeric" min={1} max={40} step={1} value="30" onChange={onChange} />
      </>,
    );
    const input = screen.getByLabelText("Years") as HTMLInputElement;

    // When
    fireEvent.change(input, { target: { value: "25" } });

    // Then
    expect(input.tagName).toBe("INPUT");
    expect(input.id).toBe("years");
    expect(input.type).toBe("number");
    expect(input.inputMode).toBe("numeric");
    expect([input.min, input.max, input.step]).toEqual(["1", "40", "1"]);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("draws a prefix and a suffix in the field's flow, so the text stops before them", () => {
    // Given a long unit, which a fixed right padding would let the value run under
    render(<Input aria-label="Consumption" prefix="€" suffix="L/100 km" wrapperClassName="w-36" />);

    // When
    const input = screen.getByLabelText("Consumption");
    const wrapper = input.parentElement as HTMLElement;
    const prefix = screen.getByText("€");
    const suffix = screen.getByText("L/100 km");

    // Then the wrapper draws the shared box and lays the three out in a row: the input takes
    // what the adornments leave, with no padding sized for a guessed unit width
    expect(classesOf(wrapper)).toEqual(expect.arrayContaining([...BOX, "flex", "items-center", "gap-2", "px-3", "w-36"]));
    expect([...wrapper.children]).toEqual([prefix, input, suffix]);
    expect(classesOf(input)).toEqual(expect.arrayContaining(["min-w-0", "flex-1", "border-0", "bg-transparent"]));
    expect(classesOf(input).filter((name) => /^p[lrx]-/.test(name))).toEqual([]);
    for (const adornment of [prefix, suffix]) {
      expect(classesOf(adornment)).toEqual(expect.arrayContaining(["shrink-0", "whitespace-nowrap", "pointer-events-none"]));
      expect(classesOf(adornment)).not.toContain("absolute");
    }
  });

  it("draws the focus ring, the error border and the disabled state on the adorned field's box", () => {
    // Given
    render(<Input aria-label="Rate" suffix="%" aria-invalid disabled />);

    // When
    const box = classesOf(screen.getByLabelText("Rate").parentElement as HTMLElement);

    // Then the box keys each state on the input inside it
    expect(box).toEqual(
      expect.arrayContaining([
        "has-[input:focus-visible]:ring-2",
        "has-[input:focus-visible]:ring-ring",
        "has-[input:focus-visible]:ring-offset-2",
        "has-[[aria-invalid=true]]:border-destructive-text",
        "has-[input:disabled]:opacity-50",
      ]),
    );
    expect(classesOf(screen.getByLabelText("Rate"))).toContain("focus-visible:outline-none");
  });

  it("focuses the input when the visitor presses on its unit", () => {
    // Given
    render(<Input aria-label="Distance" suffix="km" />);
    const input = screen.getByLabelText("Distance");

    // When
    const event = fireEvent.mouseDown(screen.getByText("km"));

    // Then
    expect(document.activeElement).toBe(input);
    expect(event).toBe(false);
  });

  it("renders the bare input without a wrapper when there is no adornment", () => {
    // Given a field sized by its flex row
    const { container } = render(<Input aria-label="Row name" className="min-w-0 flex-1" />);

    // Then the classes land on the input itself, the container's only child
    const input = screen.getByLabelText("Row name");
    expect(container.firstElementChild).toBe(input);
    expect(classesOf(input)).toEqual(expect.arrayContaining(["min-w-0", "flex-1", "px-3"]));
  });
});
