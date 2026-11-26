// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { appDemoUrl, appSignupUrl } from "./appLinks";
import { createConsentDecision, writeConsentDecision } from "./consent";
import { SUPPORTED_LANGS } from "./i18nLocale";
import { installLandingSourceLinks, withLandingSource, withSignupAttribution } from "./landingSource";

// The sign-up link of an Italian page: the app's sign-up in Italian.
const CTA_URL = appSignupUrl("it");

const allowAnalytics = (analytics: boolean) =>
  writeConsentDecision(window.localStorage, createConsentDecision({ analytics, ads: false }));

describe("landing source on signup links", () => {
  afterEach(() => window.localStorage.clear());

  it("is added only to links to the app's signup", () => {
    expect(withLandingSource(CTA_URL, "toolMortgage")).toBe(`${CTA_URL}?landing_source=toolMortgage`);
    expect(withLandingSource("https://app.wonder.money/it/auth/login", "toolMortgage")).toBe("https://app.wonder.money/it/auth/login");
    expect(withLandingSource(appDemoUrl("it"), "toolMortgage")).toBe(appDemoUrl("it"));
    expect(withLandingSource("https://example.com/auth/signup", "toolMortgage")).toBe("https://example.com/auth/signup");
    expect(withLandingSource(`${CTA_URL}?landing_source=toolMortgage`, undefined)).toBe(CTA_URL);
  });

  it("is added to the sign-up link of a page in every language", () => {
    for (const locale of SUPPORTED_LANGS) {
      const signup = appSignupUrl(locale);
      expect(withSignupAttribution(signup, { landingSource: "toolMortgage", referrerClass: "search" }), locale).toBe(
        `${signup}?landing_source=toolMortgage&referrer_class=search`,
      );
    }
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
    // A visit with no referrer: `direct` rides beside the id (see "referrer class" below).
    expect(signup.href).toBe(`${CTA_URL}?landing_source=toolMortgage&referrer_class=direct`);
    page.getElementById("other")?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(page.getElementById("other")?.getAttribute("href")).toBe("https://wonder.money/en/tools");

    // Withdrawn after the page loaded: the id comes back off before the link is followed.
    allowAnalytics(false);
    follow("click");
    expect(signup.href).toBe(CTA_URL);
  });

  it("puts no landing source on a page that is not a tool or list", () => {
    allowAnalytics(true);
    const page = document.implementation.createHTMLDocument();
    page.body.innerHTML = `<a id="signup" href="${CTA_URL}">Start</a>`;
    installLandingSourceLinks(page);
    const signup = page.getElementById("signup") as HTMLAnchorElement;

    signup.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    expect(new URL(signup.href).searchParams.has("landing_source")).toBe(false);
  });
});

describe("referrer class on signup links", () => {
  afterEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  // A page reached from a ChatGPT answer, as `document.referrer` and the address show it. The
  // document has no browsing context, so its address is the test window's.
  const fromChatGpt = (landingSource?: string) => {
    window.history.replaceState(null, "", "/it?utm_source=chatgpt.com");
    const page = document.implementation.createHTMLDocument();
    Object.defineProperty(page, "referrer", { value: "https://chatgpt.com/" });
    if (landingSource) page.body.dataset.landingSource = landingSource;
    page.body.innerHTML = `<a id="signup" href="${CTA_URL}">Start</a>`;
    installLandingSourceLinks(page);
    const signup = page.getElementById("signup") as HTMLAnchorElement;
    const follow = () => signup.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    return { follow, signup };
  };

  it("rides a followed signup link from any page with analytics consent, and only the class", () => {
    allowAnalytics(true);
    const { follow, signup } = fromChatGpt();

    follow();

    expect(signup.href).toBe(`${CTA_URL}?referrer_class=ai_assistant`);
  });

  it("sits beside the landing source on a tool page", () => {
    allowAnalytics(true);
    const { follow, signup } = fromChatGpt("toolMortgage");

    follow();

    expect(signup.href).toBe(`${CTA_URL}?landing_source=toolMortgage&referrer_class=ai_assistant`);
  });

  it("is never added without consent, and comes back off when it is withdrawn", () => {
    const { follow, signup } = fromChatGpt("toolMortgage");

    follow();
    expect(signup.href).toBe(CTA_URL);
    expect(window.sessionStorage.length).toBe(0);

    allowAnalytics(true);
    follow();
    allowAnalytics(false);
    follow();
    expect(signup.href).toBe(CTA_URL);
  });

  it("is added only to links to the app's signup", () => {
    expect(withSignupAttribution("https://example.com/auth/signup", { referrerClass: "ai_assistant" })).toBe(
      "https://example.com/auth/signup",
    );
  });
});
