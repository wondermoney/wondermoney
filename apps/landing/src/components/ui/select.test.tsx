// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Select } from "./select";

afterEach(cleanup);

describe("Select", () => {
  it("replaces the native arrow with its own chevron at the text's inset", () => {
    // Given
    render(
      <>
        <label htmlFor="pick">Pick</label>
        <Select id="pick" defaultValue="b">
          <option value="a">A</option>
          <option value="b">B</option>
        </Select>
      </>,
    );

    // When
    const select = screen.getByLabelText("Pick");
    const chevron = select.parentElement?.querySelector("svg");
    const selectClasses = select.className.split(/\s+/);
    const chevronClasses = chevron?.getAttribute("class")?.split(/\s+/) ?? [];

    // Then: 40px tall, 12px text inset on the left, the chevron 12px from the right
    expect(select.tagName).toBe("SELECT");
    expect(selectClasses).toEqual(expect.arrayContaining(["appearance-none", "h-10", "pl-3", "pr-9"]));
    expect(selectClasses).toEqual(expect.arrayContaining(["focus-visible:ring-2", "focus-visible:ring-ring"]));
    expect(select.parentElement?.className.split(/\s+/)).toContain("relative");
    expect(chevron?.getAttribute("aria-hidden")).toBe("true");
    expect(chevronClasses).toEqual(expect.arrayContaining(["absolute", "right-3", "pointer-events-none"]));
  });

  it("sets its options in the body face, never the figures font", () => {
    // Given a caller that asks for the mono face
    render(
      <Select aria-label="Year" className="font-mono" defaultValue="2024">
        <option value="2024">2024</option>
      </Select>,
    );

    // Then the control stays in Geist Sans
    const classes = screen.getByLabelText("Year").className.split(/\s+/);
    expect(classes).toContain("font-sans");
    expect(classes).not.toContain("font-mono");
  });

  it("passes the id, value, onChange and disabled state through to the native control", () => {
    // Given
    const onChange = vi.fn();
    const { rerender } = render(
      <Select id="tenor" aria-label="Tenor" value="3" onChange={onChange}>
        <option value="3">3 months</option>
        <option value="6">6 months</option>
      </Select>,
    );
    const select = screen.getByLabelText("Tenor") as HTMLSelectElement;

    // When
    fireEvent.change(select, { target: { value: "6" } });
    rerender(
      <Select id="tenor" aria-label="Tenor" value="6" onChange={onChange} disabled>
        <option value="3">3 months</option>
        <option value="6">6 months</option>
      </Select>,
    );

    // Then
    expect(select.id).toBe("tenor");
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(select.value).toBe("6");
    expect(select.disabled).toBe(true);
  });
});
