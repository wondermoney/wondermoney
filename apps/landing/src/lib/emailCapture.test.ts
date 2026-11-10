import { describe, expect, it } from "vitest";
import { emailCaptureSchema } from "./emailCapture";

describe("emailCaptureSchema", () => {
  it("shows a clear validation message when email is missing", () => {
    const result = emailCaptureSchema.safeParse({});

    expect(result.success).toBe(false);
    if (result.success) {
      return;
    }

    expect(result.error.issues[0]?.message).toBe(
      "Please enter a valid email address.",
    );
  });

  it("rejects malformed email addresses", () => {
    const result = emailCaptureSchema.safeParse({ email: "not-an-email" });

    expect(result.success).toBe(false);
    if (result.success) {
      return;
    }

    expect(result.error.issues[0]?.message).toBe(
      "Please enter a valid email address.",
    );
  });

  it("accepts a valid payload", () => {
    const result = emailCaptureSchema.safeParse({
      email: "jane@example.com",
    });

    expect(result.success).toBe(true);
  });
});
