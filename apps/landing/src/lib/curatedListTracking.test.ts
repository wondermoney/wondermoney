// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { createConsentDecision, publishConsentDecision, defaultConsentDecision, writeConsentDecision } from "./consent";
import { trackCuratedListPage } from "./curatedListTracking";

vi.mock("./posthog", () => ({ capturePostHogEvent: vi.fn() }));

function listPage() {
  const root = document.createElement("article");
  root.dataset.curatedList = "podcasts";
  root.innerHTML = `
    <a data-curated-entry-link="podcast" href="https://example.com/show"><span>Show</span></a>
    <a href="/en/tools/fire-calculator">Related tool</a>`;
  document.body.appendChild(root);
  return root;
}

const events = () => (window.dataLayer ?? []).map((entry) => (entry as { event: string }).event);

describe("curated list tracking", () => {
  afterEach(() => {
    window.localStorage.clear();
    document.body.innerHTML = "";
    window.dataLayer = [];
  });

  it("sends a view and an entry click with the list, the format and the address only", () => {
    window.dataLayer = [];
    writeConsentDecision(window.localStorage, createConsentDecision({ analytics: true, ads: false }));
    const root = listPage();
    trackCuratedListPage(root);

    root.querySelector("span")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    root.querySelector("a[href^='/']")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(window.dataLayer).toEqual([
      { event: "curated_list_viewed", list: "podcasts", page_type: "homepage" },
      {
        event: "curated_list_entry_click",
        list: "podcasts",
        format: "podcast",
        destination: "https://example.com/show",
        page_type: "homepage",
      },
    ]);
  });

  it("sends nothing without consent, and counts the view once consent is given", () => {
    window.dataLayer = [];
    const root = listPage();
    trackCuratedListPage(root);
    root.querySelector("span")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(events()).toEqual([]);

    const granted = createConsentDecision({ analytics: true, ads: false });
    writeConsentDecision(window.localStorage, granted);
    publishConsentDecision(window, defaultConsentDecision(), granted);
    publishConsentDecision(window, granted, granted);

    expect(events()).toEqual(["curated_list_viewed"]);
  });
});
