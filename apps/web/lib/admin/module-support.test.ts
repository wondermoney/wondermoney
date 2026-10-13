import { describe, expect, it } from "vitest";

import type { InstanceDescription } from "@/lib/api/instance/useInstance";

import { isModuleSupported } from "./useAdminModuleVisibility";

const features = (overrides: Partial<InstanceDescription["features"]> = {}): InstanceDescription["features"] => ({
  ai: { assistant: true, csvMapping: true, enrichment: true, monthlyStory: true, ocr: true },
  bankSync: true,
  contactForm: true,
  email: true,
  fileStorage: true,
  marketData: true,
  ...overrides,
});

describe("isModuleSupported", () => {
  it("hides financial markets on a server without market data", () => {
    expect(isModuleSupported("financialMarkets", features({ marketData: false }))).toBe(false);
  });

  it("hides the assistant on a server without an assistant model", () => {
    expect(isModuleSupported("assistant", features({ ai: { ...features().ai, assistant: false } }))).toBe(false);
  });

  it("keeps modules that need nothing optional, and treats a still-loading server as capable", () => {
    expect(isModuleSupported("goals", features({ marketData: false }))).toBe(true);
    expect(isModuleSupported("financialMarkets", undefined)).toBe(true);
  });
});
