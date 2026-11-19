import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { getToolStaticPaths } from "../pageStaticPaths";
import { getRelatedContentTools } from "../relatedContentTools";
import { SUPPORTED_LANGS, resolveToolRouteIdFromLegacy, toLocalizedPath, type Lang } from "../routes";
import { buildToolsHub } from "../toolsCatalog";
import { getTranslations } from "../translations";

vi.mock("sanity:client", () => ({ sanityClient: { fetch: vi.fn() } }));

const pages = {
  toolChristmasAllowance: {
    key: "christmasAllowance",
    slugs: {
      pt: "simulador-subsidio-de-natal",
      en: "portugal-christmas-allowance-calculator",
      es: "calculadora-paga-extra-navidad-portugal",
      fr: "calculateur-prime-noel-portugal",
      de: "weihnachtsgeld-rechner-portugal",
      it: "calcolatore-tredicesima-portogallo",
    } satisfies Record<Lang, string>,
  },
  toolHolidayAllowance: {
    key: "holidayAllowance",
    slugs: {
      pt: "simulador-subsidio-de-ferias",
      en: "portugal-holiday-allowance-calculator",
      es: "calculadora-paga-vacaciones-portugal",
      fr: "calculateur-prime-vacances-portugal",
      de: "urlaubsgeld-rechner-portugal",
      it: "calcolatore-quattordicesima-portogallo",
    } satisfies Record<Lang, string>,
  },
} as const;
const routeIds = Object.keys(pages) as Array<keyof typeof pages>;

function localeCopy(lang: Lang, base: "src" | "public", key: string) {
  const file = new URL(`../../../${base}/locales/${lang}/common.json`, import.meta.url);
  return JSON.parse(readFileSync(file, "utf8")).tools[key];
}

function copyShape(value: unknown): unknown {
  if (typeof value === "string") return value.match(/\{\{\w+\}\}/g)?.sort() ?? [];
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, copyShape(entry)]),
  );
}

describe.each(routeIds)("localized allowance tool page %s", (routeId) => {
  const { key, slugs } = pages[routeId];

  it.each(SUPPORTED_LANGS)("prerenders and links to the calculator in %s", (lang) => {
    const href = `/${lang}/tools/${slugs[lang]}`;
    expect(toLocalizedPath(routeId, lang)).toBe(href);
    const paths = getToolStaticPaths(lang).filter((entry) => entry.props.routeId === routeId);
    expect(paths).toHaveLength(1);
    expect(paths[0].params.tool).toBe(slugs[lang]);
    expect(resolveToolRouteIdFromLegacy(slugs[lang], lang)).toBe(routeId);
    expect(buildToolsHub(lang).flatMap((group) => group.tools)).toContainEqual(
      expect.objectContaining({ routeId, href }),
    );
    const related = getRelatedContentTools(
      [{ href: toLocalizedPath("toolNetSalary", lang) }], lang, getTranslations(lang),
    );
    expect(related).toContainEqual(expect.objectContaining({ href }));
  });

  it.each(SUPPORTED_LANGS)("has the same translation keys, placeholders and public mirror in %s", (lang) => {
    for (const namespace of [key, "allowance"]) {
      const copy = localeCopy(lang, "src", namespace);
      expect(copyShape(copy)).toEqual(copyShape(localeCopy("en", "src", namespace)));
      expect(localeCopy(lang, "public", namespace)).toEqual(copy);
    }
  });

  it("has distinct titles and descriptions", () => {
    const copies = SUPPORTED_LANGS.map((lang) => localeCopy(lang, "src", key));
    expect(new Set(copies.map((copy) => copy.pageTitle)).size).toBe(SUPPORTED_LANGS.length);
    expect(new Set(copies.map((copy) => copy.pageDescription)).size).toBe(SUPPORTED_LANGS.length);
  });

  it("keeps the CTA wording of the issue in the English copy", () => {
    const cta = localeCopy("en", "src", key).nextStepCta;
    expect(cta).toBe(
      routeId === "toolChristmasAllowance"
        ? "Split the allowance between goals and expenses"
        : "Create a holiday fund from the amount received",
    );
  });
});
