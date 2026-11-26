import { describe, expect, it } from "vitest";
import { appFaqUrl } from "./appLinks";

describe("appFaqUrl", () => {
  it("links the app's FAQ in the page's language", () => {
    expect(appFaqUrl("pt")).toBe("https://app.wonder.money/pt/faq");
    expect(appFaqUrl("es")).toBe("https://app.wonder.money/es/faq");
    expect(appFaqUrl("en")).toBe("https://app.wonder.money/en/faq");
    expect(appFaqUrl("it")).toBe("https://app.wonder.money/it/faq");
  });

  it("falls back to English for languages the app is not translated into", () => {
    expect(appFaqUrl("fr")).toBe("https://app.wonder.money/en/faq");
    expect(appFaqUrl("de")).toBe("https://app.wonder.money/en/faq");
  });
});
