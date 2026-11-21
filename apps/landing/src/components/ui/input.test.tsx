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

  it("draws a prefix and a suffix inside the field, with the text clearing them", () => {
    // Given
    render(<Input aria-label="Price" prefix="€" suffix="%" wrapperClassName="w-36" />);

    // When
    const input = screen.getByLabelText("Price");
    const wrapper = input.parentElement as HTMLElement;
    const prefix = screen.getByText("€");
    const suffix = screen.getByText("%");

    // Then
    expect(classesOf(wrapper)).toEqual(expect.arrayContaining(["relative", "w-36"]));
    expect(classesOf(input)).toEqual(expect.arrayContaining(["pl-8", "pr-12"]));
    expect(classesOf(prefix)).toEqual(expect.arrayContaining(["absolute", "left-0", "pl-3", "pointer-events-none"]));
    expect(classesOf(suffix)).toEqual(expect.arrayContaining(["absolute", "right-0", "pr-3", "pointer-events-none"]));
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
