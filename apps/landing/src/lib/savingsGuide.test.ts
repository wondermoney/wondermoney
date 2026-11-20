import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  SAVINGS_COLUMN_IDS,
  SAVINGS_GUIDE_RELATED_ROUTE_IDS,
  SAVINGS_PRODUCT_IDS,
  SAVINGS_SOURCE_IDS,
  SAVINGS_SOURCES,
  SAVINGS_TABLE,
  getProductCells,
  getTableRowCells,
} from "../content/savingsGuide";
import { buildResourcesHub } from "./resourcesHub";
import { buildAlternateLinks, SUPPORTED_LANGS, toLocalizedPath, toLocalizedPathname } from "./routes";
import { isSitemapPage } from "./sitemap";
import { getTranslations } from "./translations";

describe("savings guide table", () => {
  it("gives every product exactly one cell per column, in row order", () => {
    for (const column of SAVINGS_COLUMN_IDS) {
      const covered = SAVINGS_TABLE[column].flatMap((entry) => entry.products);
      expect(covered).toEqual([...SAVINGS_PRODUCT_IDS]);
    }
  });

  it("starts each cell on its first row and spans the rows the maintainer merged", () => {
    const spans = (product: (typeof SAVINGS_PRODUCT_IDS)[number]) =>
      Object.fromEntries(getTableRowCells(product).map(({ column, rowSpan }) => [column, rowSpan]));
    expect(spans("aforro")).toMatchObject({ guarantee: 2, topUp: 2, irs: 2 });
    expect(spans("tesouro")).toEqual({ withdrawal: 1, interest: 1 });
    expect(spans("demand")).toMatchObject({ guarantee: 3, irs: 3 });
    expect(spans("capitalisation")).toMatchObject({ guarantee: 2, topUp: 2, interest: 2 });
    expect(spans("ppr")).toEqual({ withdrawal: 1, irs: 1 });
  });

  it("repeats merged cells for every product in the stacked layout", () => {
    for (const product of SAVINGS_PRODUCT_IDS) {
      expect(getProductCells(product).map(({ column }) => column)).toEqual([...SAVINGS_COLUMN_IDS]);
    }
    expect(getProductCells("tesouro")[0]?.parts).toEqual(getProductCells("aforro")[0]?.parts);
    expect(getProductCells("savings")[0]?.parts).toEqual(["fgd", "fgdLimit"]);
  });

  it("uses only official domains as sources", () => {
    for (const id of SAVINGS_SOURCE_IDS) {
      const host = new URL(SAVINGS_SOURCES[id].url).hostname;
      expect(host).toMatch(/(^|\.)(gov\.pt|fgd\.pt|igcp\.pt|portaldasfinancas\.gov\.pt)$/);
    }
  });
});

describe("savings guide page", () => {
  const routeId = "pageSavingsGuide";
  const alternates = buildAlternateLinks(routeId);
  const messages = new Map(
    SUPPORTED_LANGS.map((locale) => [locale, JSON.parse(readFileSync(new URL(`../locales/${locale}/common.json`, import.meta.url), "utf8")).savingsGuide]),
  );

  it.each(SUPPORTED_LANGS)("is a prerendered, sitemapped page in %s", (locale) => {
    const path = toLocalizedPath(routeId, locale);
    const href = `https://wonder.money${path}`;
    const file = new URL(`../pages${path}.astro`, import.meta.url);
    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file, "utf8")).toContain("export const prerender = true");
    expect(alternates).toContainEqual({ hrefLang: locale, href });
    expect(isSitemapPage(href)).toBe(true);
    expect(toLocalizedPathname(toLocalizedPath(routeId, "en"), locale)).toBe(path);
  });

  it.each(SUPPORTED_LANGS)("is linked from the resources hub in %s", (locale) => {
    const link = buildResourcesHub(locale).find(({ destination }) => destination === "savings_guide");
    expect(link?.href).toBe(toLocalizedPath(routeId, locale));
  });

  it("links the calculators that exist", () => {
    for (const toolRouteId of SAVINGS_GUIDE_RELATED_ROUTE_IDS) {
      for (const locale of SUPPORTED_LANGS) {
        expect(toLocalizedPath(toolRouteId, locale).startsWith(`/${locale}/tools/`)).toBe(true);
      }
    }
  });

  it.each(SUPPORTED_LANGS)("has every table and section string in %s", (locale) => {
    const t = getTranslations(locale);
    const usedCells = new Set(Object.values(SAVINGS_TABLE).flatMap((cells) => cells.flatMap((entry) => entry.parts)));
    for (const part of usedCells) expect(t(`savingsGuide.cells.${part}`).trim()).not.toBe("");
    for (const product of SAVINGS_PRODUCT_IDS) {
      expect(t(`savingsGuide.products.${product}.name`).trim()).not.toBe("");
      expect(t(`savingsGuide.products.${product}.text`).trim()).not.toBe("");
    }
    for (const source of SAVINGS_SOURCE_IDS) expect(t(`savingsGuide.sources.items.${source}`).trim()).not.toBe("");
    expect(t("savingsGuide.checked", { date: "x" })).toContain("x");
  });

  it("keeps the same keys in every locale", () => {
    const keys = (value: unknown, prefix = ""): string[] =>
      typeof value === "object" && value !== null
        ? Object.entries(value).flatMap(([key, child]) => keys(child, `${prefix}${key}.`))
        : [prefix];
    const reference = keys(messages.get("en")).sort();
    for (const locale of SUPPORTED_LANGS) expect(keys(messages.get(locale)).sort()).toEqual(reference);
  });

  it("mentions the guarantee limit and 28% rate in every locale", () => {
    for (const locale of SUPPORTED_LANGS) {
      const t = getTranslations(locale);
      expect(t("savingsGuide.cells.fgdLimit")).toMatch(/100\p{Z}?000|100[.,]000/u);
      expect(t("savingsGuide.cells.rate28")).toContain("28");
    }
  });
});
