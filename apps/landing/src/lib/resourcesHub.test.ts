import { existsSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { getToolStaticPaths, getTopLevelPageStaticPaths } from "./pageStaticPaths";
import { buildResourcesHub } from "./resourcesHub";
import { buildAlternateLinks, SUPPORTED_LANGS, toLocalizedPath, toLocalizedPathname } from "./routes";
import { isSitemapPage } from "./sitemap";
import { getTranslations } from "./translations";

vi.mock("sanity:client", () => ({ sanityClient: { fetch: vi.fn() } }));

describe("resources hub routes", () => {
  const routeId = "pageResources";
  const alternates = buildAlternateLinks(routeId);

  it.each(SUPPORTED_LANGS)("publishes the hub and all its destinations in %s", (locale) => {
    const path = toLocalizedPath(routeId, locale);
    const href = `https://wonder.money${path}`;
    expect(existsSync(new URL(`../pages${path}.astro`, import.meta.url))).toBe(true);
    expect(alternates).toContainEqual({ hrefLang: locale, href });
    expect(isSitemapPage(href)).toBe(true);
    expect(toLocalizedPathname(toLocalizedPath(routeId, "en"), locale)).toBe(path);

    const generatedPaths = [
      ...getToolStaticPaths(locale).map(({ params }) => `/${locale}/tools/${params.tool}`),
      ...getTopLevelPageStaticPaths(locale).map(({ params }) => `/${locale}/${params.page}`),
    ];
    for (const link of buildResourcesHub(locale)) {
      expect(link.href.startsWith(`/${locale}/`)).toBe(true);
      const hubFile = new URL(`../pages${link.href}/index.astro`, import.meta.url);
      const standaloneFile = new URL(`../pages${link.href}.astro`, import.meta.url);
      expect(existsSync(hubFile) || existsSync(standaloneFile) || generatedPaths.includes(link.href)).toBe(true);
      expect(link.title.trim()).not.toBe("");
      expect(link.description.trim()).not.toBe("");
    }
  });

  it.each(["metaTitle", "metaDescription"])("provides a distinct %s per locale", (key) => {
    const values = SUPPORTED_LANGS.map((locale) => getTranslations(locale)(`resources.${key}`));
    expect(values.every((value) => value.trim().length > 0)).toBe(true);
    expect(new Set(values).size).toBe(SUPPORTED_LANGS.length);
  });
});
