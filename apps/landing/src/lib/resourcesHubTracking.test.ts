// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { createConsentDecision, writeConsentDecision } from "./consent";
import { trackResourcesHubClicks } from "./resourcesHubTracking";

vi.mock("./posthog", () => ({ capturePostHogEvent: vi.fn() }));

describe("resources hub click tracking", () => {
  afterEach(() => window.localStorage.clear());

  it("counts normal and middle clicks on marked links only with analytics consent", () => {
    window.dataLayer = [];
    const root = document.createElement("ul");
    trackResourcesHubClicks(root);

    const dispatch = (type: string, button: number, destination?: string) => {
      const link = document.createElement("a");
      if (destination) link.dataset.resourceDestination = destination;
      const child = link.appendChild(document.createElement("span"));
      root.appendChild(link);
      child.dispatchEvent(new MouseEvent(type, { button, bubbles: true }));
    };

    dispatch("click", 0, "guides");
    expect(window.dataLayer).toEqual([]);

    writeConsentDecision(window.localStorage, createConsentDecision({ analytics: true, ads: false }));
    dispatch("click", 0);
    dispatch("auxclick", 2, "guides");
    dispatch("click", 0, "guides");
    dispatch("auxclick", 1, "emergency_fund");

    writeConsentDecision(window.localStorage, createConsentDecision({ analytics: false, ads: false }));
    dispatch("click", 0, "tools");
    expect(window.dataLayer).toEqual([
      { event: "resources_hub_click", destination: "guides", page_type: "resources" },
      { event: "resources_hub_click", destination: "emergency_fund", page_type: "resources" },
    ]);
  });
});
