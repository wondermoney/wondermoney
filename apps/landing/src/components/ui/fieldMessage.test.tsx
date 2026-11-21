// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { FieldMessage, fieldMessageClass } from "./fieldMessage";

afterEach(cleanup);

const classesOf = (element: Element) => element.className.split(/\s+/);

describe("FieldMessage", () => {
  it("sets help and error lines at one size, in muted ink and in the destructive text token", () => {
    // Given a help line and an error line under a field
    render(
      <>
        <FieldMessage id="start-help">Weekends count as days off.</FieldMessage>
        <FieldMessage id="start-error" tone="error">
          The end date is before the start date.
        </FieldMessage>
      </>,
    );

    // When
    const help = classesOf(screen.getByText("Weekends count as days off."));
    const error = classesOf(screen.getByText("The end date is before the start date."));

    // Then both are 12px, the help muted and the error in destructive-text, never the fill
    expect(help).toEqual(expect.arrayContaining(["text-xs", "text-muted-foreground"]));
    expect(error).toEqual(expect.arrayContaining(["text-xs", "text-destructive-text"]));
    expect(error).not.toContain("text-destructive");
    expect(error).not.toContain("text-sm");
  });

  it("keeps the id and role the field ties it to, and takes layout classes", () => {
    // Given
    render(
      <FieldMessage id="fuel-error" tone="error" role="alert" className="pl-6">
        Pick a fuel.
      </FieldMessage>,
    );

    // When
    const message = screen.getByRole("alert");

    // Then
    expect(message.tagName).toBe("P");
    expect(message.id).toBe("fuel-error");
    expect(classesOf(message)).toEqual(expect.arrayContaining(["pl-6", "text-xs", "text-destructive-text"]));
  });

  it("shares one size across every tone", () => {
    const sizes = Object.values(fieldMessageClass).map((classes) => classes.split(" ").filter((name) => /^text-(xs|sm|base)$/.test(name)));
    expect(sizes).toEqual(Object.values(fieldMessageClass).map(() => ["text-xs"]));
  });
});
