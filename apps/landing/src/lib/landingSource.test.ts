// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { CTA_URL } from "@/hooks/useCtaUrl";
import { createConsentDecision, writeConsentDecision } from "./consent";
import { installLandingSourceLinks, withLandingSource } from "./landingSource";

const allowAnalytics = (analytics: boolean) =>
  writeConsentDecision(window.localStorage, createConsentDecision({ analytics, ads: false }));

describe("landing source on signup links", () => {
  afterEach(() => window.localStorage.clear());

  it("is added only to links to the app's signup", () => {
    expect(withLandingSource(CTA_URL, "toolMortgage")).toBe(`${CTA_URL}?landing_source=toolMortgage`);
    expect(withLandingSource("https://app.wonder.money/auth/login", "toolMortgage")).toBe("https://app.wonder.money/auth/login");
    expect(withLandingSource("https://example.com/auth/signup", "toolMortgage")).toBe("https://example.com/auth/signup");
    expect(withLandingSource(`${CTA_URL}?landing_source=toolMortgage`, undefined)).toBe(CTA_URL);
  });

  it("rides a followed signup link from a tool page only with analytics consent", () => {
    // A document of its own, with no browsing context: following a link navigates nowhere.
    const page = document.implementation.createHTMLDocument();
    page.body.dataset.landingSource = "toolMortgage";
    page.body.innerHTML = `<a id="signup" href="${CTA_URL}"><span>Start</span></a><a id="other" href="https://wonder.money/en/tools">Tools</a>`;
    installLandingSourceLinks(page);
    const signup = page.getElementById("signup") as HTMLAnchorElement;
    const follow = (type: string, button = 0) =>
      signup.querySelector("span")?.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button }));

    follow("click");
    expect(signup.href).toBe(CTA_URL);

    allowAnalytics(true);
    follow("auxclick", 1);
    expect(signup.href).toBe(`${CTA_URL}?landing_source=toolMortgage`);
    page.getElementById("other")?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(page.getElementById("other")?.getAttribute("href")).toBe("https://wonder.money/en/tools");

    // Withdrawn after the page loaded: the id comes back off before the link is followed.
    allowAnalytics(false);
    follow("click");
    expect(signup.href).toBe(CTA_URL);
  });

  it("leaves signup links alone on a page that is not a tool or list", () => {
    allowAnalytics(true);
    const page = document.implementation.createHTMLDocument();
    page.body.innerHTML = `<a id="signup" href="${CTA_URL}">Start</a>`;
    installLandingSourceLinks(page);
    const signup = page.getElementById("signup") as HTMLAnchorElement;

    signup.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    expect(signup.href).toBe(CTA_URL);
  });
});
