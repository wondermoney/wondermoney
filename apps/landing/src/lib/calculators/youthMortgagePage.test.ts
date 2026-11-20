import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getToolStaticPaths } from "../pageStaticPaths";
import { getRelatedContentTools } from "../relatedContentTools";
import { SUPPORTED_LANGS, resolveToolRouteIdFromLegacy, toLocalizedPath, type Lang } from "../routes";
import { buildToolsHub } from "../toolsCatalog";
import { getTranslations } from "../translations";

const slugs = {
  pt: "simulador-credito-habitacao-jovem",
  en: "youth-mortgage-calculator-portugal",
  es: "calculadora-hipoteca-joven-portugal",
  fr: "simulateur-credit-immobilier-jeune-portugal",
  de: "jugend-immobilienkredit-portugal-rechner",
  it: "calcolo-mutuo-giovani-portogallo",
} satisfies Record<Lang, string>;

function localeCopy(lang: Lang, base: "src" | "public") {
  const file = new URL(`../../../${base}/locales/${lang}/common.json`, import.meta.url);
  return JSON.parse(readFileSync(file, "utf8")).tools.youthMortgage;
}

function copyShape(value: unknown): unknown {
  if (typeof value === "string") return value.match(/\{\{\w+\}\}/g)?.sort() ?? [];
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, copyShape(entry)]),
  );
}

describe("localized youth mortgage tool page", () => {
  it.each(SUPPORTED_LANGS)("prerenders and links to the calculator in %s", (lang) => {
    const href = `/${lang}/tools/${slugs[lang]}`;
    expect(toLocalizedPath("toolYouthMortgage", lang)).toBe(href);
    const paths = getToolStaticPaths(lang).filter((entry) => entry.props.routeId === "toolYouthMortgage");
    expect(paths).toHaveLength(1);
    expect(paths[0].params.tool).toBe(slugs[lang]);
    expect(resolveToolRouteIdFromLegacy(slugs[lang], lang)).toBe("toolYouthMortgage");
    expect(buildToolsHub(lang).flatMap((group) => group.tools)).toContainEqual(
      expect.objectContaining({ routeId: "toolYouthMortgage", href }),
    );
    const related = getRelatedContentTools(
      [{ href: toLocalizedPath("toolMortgage", lang) }], lang, getTranslations(lang),
    );
    expect(related).toContainEqual(expect.objectContaining({ href }));
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
