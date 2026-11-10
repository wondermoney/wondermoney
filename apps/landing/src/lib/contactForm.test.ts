import { describe, expect, it } from "vitest";
import { contactFormSchema } from "./contactForm";

describe("contactFormSchema", () => {
  it("shows a clear validation message when message is missing", () => {
    const result = contactFormSchema.safeParse({
      name: "Jane Doe",
      email: "jane@example.com",
    });

    expect(result.success).toBe(false);
    if (result.success) {
      return;
    }

    expect(result.error.issues[0]?.message).toBe(
      "Please enter at least 10 characters in your message.",
    );
  });

  it("rejects whitespace-only messages", () => {
    const result = contactFormSchema.safeParse({
      name: "Jane Doe",
      email: "jane@example.com",
      message: "     ",
    });

    expect(result.success).toBe(false);
    if (result.success) {
      return;
    }

    expect(result.error.issues[0]?.message).toBe(
      "Please enter at least 10 characters in your message.",
    );
  });

  it("accepts valid payload", () => {
    const result = contactFormSchema.safeParse({
      name: "Jane Doe",
      email: "jane@example.com",
      message: "I would like to know more about your pricing.",
    });

    expect(result.success).toBe(true);
  });
});
