// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import {
  REFERRER_CLASSES,
  REFERRER_CLASS_STORAGE_KEY,
  classifyReferrer,
  consentedReferrerClass,
  forgetReferrerClass,
} from "./referrerClass";

const PAGE = "https://wonder.money/it";

describe("classifyReferrer", () => {
  it.each([
    ["https://chatgpt.com/", "ai_assistant"],
    ["https://chat.openai.com/c/abc", "ai_assistant"],
    ["https://www.perplexity.ai/search?q=budget", "ai_assistant"],
    ["https://gemini.google.com/app", "ai_assistant"],
    ["https://copilot.microsoft.com/", "ai_assistant"],
    ["https://claude.ai/chat/1", "ai_assistant"],
    ["android-app://com.openai.chatgpt/", "ai_assistant"],
    ["https://www.google.com/", "search"],
    ["https://www.google.pt/", "search"],
    ["https://google.co.uk/", "search"],
    ["https://www.bing.com/search?q=wondermoney", "search"],
    ["https://duckduckgo.com/", "search"],
    ["https://www.ecosia.org/", "search"],
    ["android-app://com.google.android.googlequicksearchbox/", "search"],
    ["https://l.facebook.com/", "social"],
    ["https://t.co/abc", "social"],
    ["https://www.reddit.com/r/eupersonalfinance", "social"],
    ["https://www.linkedin.com/feed", "social"],
    ["https://www.youtube.com/watch?v=1", "social"],
    ["https://example.com/blog", "other"],
    ["https://docs.wonder.money/en/docs", "other"],
    ["https://mail.google.com/", "other"],
    ["android-app://com.example.reader/", "other"],
  ] as const)("classifies a visit from %s as %s", (referrer, expected) => {
    expect(classifyReferrer(referrer, PAGE)).toBe(expected);
  });

  it("counts a visit without a referrer as direct", () => {
    expect(classifyReferrer("", PAGE)).toBe("direct");
  });

  it("goes by utm_source first, as ChatGPT's links carry it", () => {
    expect(classifyReferrer("", `${PAGE}?utm_source=chatgpt.com`)).toBe("ai_assistant");
    expect(classifyReferrer("https://example.com/", `${PAGE}?utm_source=perplexity`)).toBe("ai_assistant");
    expect(classifyReferrer("", `${PAGE}?utm_source=google&utm_medium=cpc`)).toBe("search");
    expect(classifyReferrer("", `${PAGE}?utm_source=facebook`)).toBe("social");
  });

  it("falls back to the referrer for an unknown utm_source, and to other without one", () => {
    expect(classifyReferrer("https://chatgpt.com/", `${PAGE}?utm_source=newsletter`)).toBe("ai_assistant");
    expect(classifyReferrer("", `${PAGE}?utm_source=newsletter`)).toBe("other");
  });

  it("has no class for a click from one page of the site to the next", () => {
    expect(classifyReferrer("https://wonder.money/it/features/budgeting", PAGE)).toBeUndefined();
  });

  it("only ever answers one of the coarse classes", () => {
    const inputs = ["", "not a url", "https://chatgpt.com/", "https://example.com/?q=person@example.com", "javascript:alert(1)"];
    for (const referrer of inputs) {
      const value = classifyReferrer(referrer, `${PAGE}?utm_source=${encodeURIComponent(referrer)}`);
      expect(value === undefined || (REFERRER_CLASSES as readonly string[]).includes(value)).toBe(true);
    }
  });
});

describe("the visit's class across its pages", () => {
  afterEach(() => window.sessionStorage.clear());

  const pageWith = (referrer: string, url: string) =>
    ({ referrer, location: new URL(url) }) as unknown as Document;

  it("keeps the first page's class for the pages reached from it", () => {
    expect(consentedReferrerClass(pageWith("https://chatgpt.com/", PAGE), window)).toBe("ai_assistant");
    expect(window.sessionStorage.getItem(REFERRER_CLASS_STORAGE_KEY)).toBe("ai_assistant");

    expect(consentedReferrerClass(pageWith(PAGE, "https://wonder.money/it/features/budgeting"), window)).toBe("ai_assistant");
  });

  it("stores the class only, never the referrer or the campaign", () => {
    consentedReferrerClass(pageWith("https://chatgpt.com/c/secret", `${PAGE}?utm_source=chatgpt.com&utm_campaign=x`), window);

    const stored = Object.keys(window.sessionStorage).map((key) => window.sessionStorage.getItem(key));
    expect(stored).toEqual(["ai_assistant"]);
  });

  it("has no class on a later page when nothing was kept, and forgets it on withdrawal", () => {
    expect(consentedReferrerClass(pageWith(PAGE, "https://wonder.money/it/tools"), window)).toBeUndefined();

    consentedReferrerClass(pageWith("", PAGE), window);
    forgetReferrerClass(window);
    expect(window.sessionStorage.getItem(REFERRER_CLASS_STORAGE_KEY)).toBeNull();
  });
});
