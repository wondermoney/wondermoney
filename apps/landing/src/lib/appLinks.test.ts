import { describe, expect, it } from "vitest";
import { SUPPORTED_LANGS } from "./i18nLocale";
import { getTranslations } from "./translations";
import {
  APP_LANGS,
  appDemoUrl,
  appFaqUrl,
  appLang,
  appSignupUrl,
  isAppSignupUrl,
} from "./appLinks";

// The page's language and the app's language it opens, for every route tree of the site.
const APP_LANG_FOR_PAGE = { pt: "pt", en: "en", es: "es", it: "it", fr: "en", de: "en" } as const;

describe("appLang", () => {
  it("opens the app in the page's language, or English where the app has no translation", () => {
    for (const locale of SUPPORTED_LANGS) {
      expect(appLang(locale), locale).toBe(APP_LANG_FOR_PAGE[locale]);
    }
  });

  it("names only languages the app serves (apps/web/i18n/routing.ts)", () => {
    expect([...APP_LANGS].sort()).toEqual(["en", "es", "it", "pt"]);
  });
});

describe("appSignupUrl", () => {
  it("links sign-up on the hosted app in the page's language", () => {
    for (const locale of SUPPORTED_LANGS) {
      expect(appSignupUrl(locale), locale).toBe(`https://app.wonder.money/${APP_LANG_FOR_PAGE[locale]}/auth/signup`);
    }
  });

  it("is a link the signup attribution recognises, in every language", () => {
    for (const locale of SUPPORTED_LANGS) {
      expect(isAppSignupUrl(new URL(appSignupUrl(locale))), locale).toBe(true);
    }
    expect(isAppSignupUrl(new URL(appDemoUrl("it")))).toBe(false);
    expect(isAppSignupUrl(new URL("https://app.wonder.money/fr/auth/signup"))).toBe(false);
    expect(isAppSignupUrl(new URL("https://example.com/it/auth/signup"))).toBe(false);
  });
});

describe("appDemoUrl", () => {
  it("links the app's sign-in page in the page's language with the flag that starts the demo there", () => {
    for (const locale of SUPPORTED_LANGS) {
      const demo = new URL(appDemoUrl(locale));

      // The demo session cookie is set on the app's origin, the same one sign-up lives on.
      expect(demo.origin, locale).toBe(new URL(appSignupUrl(locale)).origin);
      expect(demo.pathname, locale).toBe(`/${APP_LANG_FOR_PAGE[locale]}/auth/login`);
      expect([...demo.searchParams], locale).toEqual([["demo", "1"]]);
    }
  });

  it("has its own label in every locale, apart from the sign-up action", () => {
    for (const lang of SUPPORTED_LANGS) {
      const t = getTranslations(lang);
      const label = t("global.demoCta");

      expect(label, lang).toMatch(/\S/);
      expect(label, lang).not.toBe(t("global.mainCta"));
      expect(label, lang).not.toBe(t("homepage.hero.newCta"));
    }
  });
});

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
