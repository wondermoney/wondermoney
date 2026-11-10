import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

import { applyTrackingConsent } from "./gtm";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("tracking consent", () => {
  it("keeps denied and undecided tracking state entirely local", () => {
    // Given
    const browserWindow: Record<string, unknown> = {};
    const appendedScripts: unknown[] = [];
    vi.stubGlobal("window", browserWindow);
    vi.stubGlobal("document", {
      getElementById: () => null,
      createElement: () => ({}),
      head: { append: (script: unknown) => appendedScripts.push(script) },
    });

    // When
    applyTrackingConsent({ analytics: false, ads: false });

    // Then
    expect(browserWindow).not.toHaveProperty("dataLayer");
    expect(appendedScripts).toEqual([]);
  });

  it("queues required consent commands only when granting analytics before loading GTM", () => {
    // Given
    const browserWindow: Record<string, unknown> = {};
    const appendedScripts: Array<Record<string, unknown>> = [];
    vi.stubGlobal("window", browserWindow);
    vi.stubGlobal("document", {
      getElementById: () => null,
      createElement: () => ({}),
      head: {
        append: (script: Record<string, unknown>) =>
          appendedScripts.push(script),
      },
    });

    // When
    applyTrackingConsent({ analytics: true, ads: false });

    // Then
    expect(browserWindow.dataLayer).toEqual([
      [
        "consent",
        "default",
        {
          analytics_storage: "denied",
          ad_storage: "denied",
          ad_user_data: "denied",
          ad_personalization: "denied",
        },
      ],
      [
        "consent",
        "update",
        {
          analytics_storage: "granted",
          ad_storage: "denied",
          ad_user_data: "denied",
          ad_personalization: "denied",
        },
      ],
      expect.objectContaining({ event: "gtm.js" }),
    ]);
    expect(appendedScripts).toHaveLength(1);
  });

  it("does not install a pre-consent dataLayer shim in the document layout", () => {
    // Given
    const layout = readFileSync("src/layouts/Layout.astro", "utf8");

    // When
    const createsTrackingQueue = /dataLayer|gtag\s*=|consent["'],\s*["']default/u.test(
      layout,
    );

    // Then
    expect(createsTrackingQueue).toBe(false);
  });
});
