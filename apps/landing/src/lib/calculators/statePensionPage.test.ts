import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { getToolStaticPaths } from "../pageStaticPaths";
import { getRelatedContentTools } from "../relatedContentTools";
import { SUPPORTED_LANGS, resolveToolRouteIdFromLegacy, toLocalizedPath, type Lang } from "../routes";
import { buildToolsHub, getToolCatalogEntry } from "../toolsCatalog";
import { getTranslations } from "../translations";

vi.mock("sanity:client", () => ({ sanityClient: { fetch: vi.fn() } }));

const slugs = {
  pt: "simulador-pensao-reforma",
  en: "portugal-state-pension-calculator",
  es: "calculadora-pension-jubilacion-portugal",
  fr: "calculateur-pension-retraite-portugal",
  de: "rentenrechner-portugal",
  it: "calcolatore-pensione-vecchiaia-portogallo",
} satisfies Record<Lang, string>;

function localeCopy(lang: Lang, base: "src" | "public") {
  const file = new URL(`../../../${base}/locales/${lang}/common.json`, import.meta.url);
  return JSON.parse(readFileSync(file, "utf8")).tools.statePension;
}

function copyShape(value: unknown): unknown {
  if (typeof value === "string") return value.match(/\{\{\w+\}\}/g)?.sort() ?? [];
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, copyShape(entry)]),
  );
}

describe("localized state pension tool page", () => {
  it.each(SUPPORTED_LANGS)("prerenders and links to the calculator in %s", (lang) => {
    const href = `/${lang}/tools/${slugs[lang]}`;
    expect(toLocalizedPath("toolStatePension", lang)).toBe(href);
    const paths = getToolStaticPaths(lang).filter((entry) => entry.props.routeId === "toolStatePension");
    expect(paths).toHaveLength(1);
    expect(paths[0].params.tool).toBe(slugs[lang]);
    expect(resolveToolRouteIdFromLegacy(slugs[lang], lang)).toBe("toolStatePension");
    expect(buildToolsHub(lang).flatMap((group) => group.tools)).toContainEqual(
      expect.objectContaining({ routeId: "toolStatePension", href }),
    );
    const related = getRelatedContentTools(
      [{ href: toLocalizedPath("toolCompoundInterest", lang) }], lang, getTranslations(lang),
    );
    expect(related).toContainEqual(expect.objectContaining({ href }));
    expect(getToolCatalogEntry("toolStatePension").related).toEqual(["toolCompoundInterest", "toolInvestmentReturn", "toolNetSalary"]);
  });

  it.each(SUPPORTED_LANGS)("names its sources, review date and unsupported situations in %s", (lang) => {
    const { guide } = localeCopy(lang, "src");
    expect(guide.reviewed).toContain("2026");
    for (const key of ["sourceGuide", "sourceLaw", "sourceAges", "sourceMinimum", "sourceSimulator", "unsupportedMixed", "unsupportedCga"]) {
      expect(guide[key]).toBeTruthy();
    }
    expect(guide.sourceAges).toContain("476/2025/1");
    expect(guide.sourceMinimum).toContain("480-B/2025/1");
    expect(guide.sourceWithholding).toContain("233-A/2026");
    expect(guide.unsupportedMixed).toContain("2002");
  });

  it.each(SUPPORTED_LANGS)("has the same translation keys, placeholders and public mirror in %s", (lang) => {
    const copy = localeCopy(lang, "src");
    expect(copyShape(copy)).toEqual(copyShape(localeCopy("en", "src")));
    expect(localeCopy(lang, "public")).toEqual(copy);
  });

  it("has distinct titles and descriptions", () => {
    const copies = SUPPORTED_LANGS.map((lang) => localeCopy(lang, "src"));
    expect(new Set(copies.map((copy) => copy.pageTitle)).size).toBe(SUPPORTED_LANGS.length);
    expect(new Set(copies.map((copy) => copy.pageDescription)).size).toBe(SUPPORTED_LANGS.length);
  });
});
