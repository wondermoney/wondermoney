import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { getToolStaticPaths } from "../pageStaticPaths";
import { getRelatedContentTools } from "../relatedContentTools";
import { SUPPORTED_LANGS, resolveToolRouteIdFromLegacy, toLocalizedPath, type Lang } from "../routes";
import { buildToolsHub } from "../toolsCatalog";
import { getTranslations } from "../translations";

vi.mock("sanity:client", () => ({ sanityClient: { fetch: vi.fn() } }));

const slugs = {
  pt: "simulador-certificados-de-aforro",
  en: "savings-certificates-calculator",
  es: "simulador-certificados-de-ahorro-portugal",
  fr: "simulateur-certificats-epargne-portugal",
  de: "sparzertifikate-portugal-rechner",
  it: "simulatore-certificati-risparmio-portogallo",
} satisfies Record<Lang, string>;

function localeCopy(lang: Lang, base: "src" | "public") {
  const file = new URL(`../../../${base}/locales/${lang}/common.json`, import.meta.url);
  return JSON.parse(readFileSync(file, "utf8")).tools.savingsCertificates;
}

function copyShape(value: unknown): unknown {
  if (typeof value === "string") return value.match(/\{\{\w+\}\}/g)?.sort() ?? [];
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, copyShape(entry)]),
  );
}

describe("localized savings certificates tool page", () => {
  it.each(SUPPORTED_LANGS)("prerenders and links to the calculator in %s", (lang) => {
    const href = `/${lang}/tools/${slugs[lang]}`;
    expect(toLocalizedPath("toolSavingsCertificates", lang)).toBe(href);
    const paths = getToolStaticPaths(lang).filter((entry) => entry.props.routeId === "toolSavingsCertificates");
    expect(paths).toHaveLength(1);
    expect(paths[0].params.tool).toBe(slugs[lang]);
    expect(resolveToolRouteIdFromLegacy(slugs[lang], lang)).toBe("toolSavingsCertificates");
    expect(buildToolsHub(lang).flatMap((group) => group.tools)).toContainEqual(
      expect.objectContaining({ routeId: "toolSavingsCertificates", href }),
    );
    const related = getRelatedContentTools(
      [{ href: toLocalizedPath("toolTermDeposit", lang) }], lang, getTranslations(lang),
    );
    expect(related).toContainEqual(expect.objectContaining({ href }));
  });

  it.each(SUPPORTED_LANGS)("has the same translation keys, placeholders and public mirror in %s", (lang) => {
    const copy = localeCopy(lang, "src");
    expect(copyShape(copy)).toEqual(copyShape(localeCopy("en", "src")));
    expect(localeCopy(lang, "public")).toEqual(copy);
  });

  it("keeps the CTA wording in English and cites the rules date", () => {
    expect(localeCopy("en", "src").nextStepCta).toBe("Include certificates in your savings overview");
    for (const lang of SUPPORTED_LANGS) expect(localeCopy(lang, "src").guide.rulesDateValue).toMatch(/2026/);
  });

  it("has distinct titles and descriptions", () => {
    const copies = SUPPORTED_LANGS.map((lang) => localeCopy(lang, "src"));
    expect(new Set(copies.map((copy) => copy.pageTitle)).size).toBe(SUPPORTED_LANGS.length);
    expect(new Set(copies.map((copy) => copy.pageDescription)).size).toBe(SUPPORTED_LANGS.length);
  });
});
