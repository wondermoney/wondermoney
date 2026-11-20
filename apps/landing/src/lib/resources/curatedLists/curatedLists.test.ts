import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getCuratedListStaticPaths } from "../../pageStaticPaths";
import { buildResourcesHub } from "../../resourcesHub";
import {
  buildAlternateLinks,
  CURATED_LIST_ROUTE_IDS,
  getLocalizedSlug,
  SUPPORTED_LANGS,
  toLocalizedPath,
  toLocalizedPathname,
  TOOL_ROUTE_IDS,
  type Lang,
} from "../../routes";
import { isSitemapPage } from "../../sitemap";
import { getToolCatalogEntry } from "../../toolsCatalog";
import { getTranslations } from "../../translations";
import {
  CURATED_LIST_IDS,
  CURATED_LIST_MAX_ENTRIES,
  CURATED_LIST_MIN_ENTRIES,
  CURATED_LIST_STALE_AFTER_DAYS,
  CURATED_LISTS,
  curatedEntries,
  daysSinceCuratedReview,
  getCuratedList,
  getCuratedListByRouteId,
  isCuratedListStale,
  type CuratedEntry,
} from "./index";
import { buildCuratedListPage, CURATED_CRITERIA } from "./page";

const pagesDir = new URL("../../../pages/", import.meta.url);
const guidesDir = new URL("../../../content/guides/", import.meta.url);

const guideTitles = (locale: Lang) =>
  new Map(
    existsSync(new URL(`${locale}/`, guidesDir))
      ? readdirSync(new URL(`${locale}/`, guidesDir))
          .filter((file) => file.endsWith(".md"))
          .map((file) => [file.replace(/\.md$/, ""), file])
      : [],
  );

const DAY = 86_400_000;
const isoDate = /^\d{4}-\d{2}-\d{2}$/;
const day = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

// Query parameters and path segments that mark a tracking or affiliate link.
const TRACKING = /[?&#]|\/ref\/|[?&](utm_|ref=|aff|fbclid|gclid|mc_|si=)/i;

// Calculators about Portuguese rules or markets: they fit the Portuguese list only.
const PORTUGAL_ONLY = new Set<string>([
  "toolInflation",
  "toolPropertyTax",
  "toolPurchaseTaxes",
  "toolYouthMortgage",
  "toolSavingsCertificates",
  "toolDepositRateIndex",
  "toolTermDepositOffers",
  "toolNetSalary",
  "toolChristmasAllowance",
  "toolHolidayAllowance",
  "toolWithholdingTables",
  "toolUnemploymentBenefit",
  "toolSickPay",
  "toolDismissalCompensation",
  "toolVehicleTax",
  "toolPropertyCapitalGains",
  "toolStatePension",
  "toolElectricityIndex",
  "toolElectricityTariffComparison",
  "toolFuelPrices",
  "toolFreeBankAccounts",
  "toolRemuneratedAccounts",
  "toolBrokerFees",
  "toolEuribor",
]);

// Rankings, superlatives and audience sizes have no place in an entry's lines.
const RANKING_WORDS =
  /\b(best|top|leading|most popular|must[- ]read|melhor(es)?|mais populares?|mejor(es)?|más popular(es)?|meilleur(e|s|es)?|incontournables?|beste[nrs]?|bekannteste[nrs]?|migliori|il miglior[ei]?|più popolar[ei]|subscribers|followers|seguidores|subscritores|suscriptores|abonnés|abonnenten|iscritti|downloads)\b/iu;

const allEntries = CURATED_LIST_IDS.flatMap((listId) =>
  SUPPORTED_LANGS.flatMap((locale) =>
    getCuratedList(listId).entries[locale].map((entry) => ({ listId, locale, entry })),
  ),
);
const label = ({ listId, locale, entry }: { listId: string; locale: Lang; entry: CuratedEntry }) =>
  `${listId}/${locale}: ${entry.name}`;

describe("curated list data", () => {
  it("registers one list per curated route", () => {
    expect(CURATED_LIST_IDS.map((id) => CURATED_LISTS[id].routeId).sort()).toEqual([...CURATED_LIST_ROUTE_IDS].sort());
    for (const id of CURATED_LIST_IDS) {
      expect(CURATED_LISTS[id].id).toBe(id);
      expect(getCuratedListByRouteId(CURATED_LISTS[id].routeId).id).toBe(id);
    }
  });

  // Lists allowed fewer than five entries because no other candidate meets the criteria. Each is
  // named in apps/landing/AGENTS.md ("Curated resource lists"); remove it once the list is back to five.
  const MIN_ENTRIES_EXCEPTIONS: Readonly<Record<string, number>> = {
    // No other Portuguese newsletter qualified on 2026-11-20. Remove when Portefólio Perfeito
    // launches its newsletter or another qualifying one turns up.
    "newsletters/pt": 4,
  };

  it("keeps each minimum-count exception below the usual minimum, so a stale one is noticed", () => {
    for (const [key, minimum] of Object.entries(MIN_ENTRIES_EXCEPTIONS)) {
      const [listId, locale] = key.split("/") as [keyof typeof CURATED_LISTS, Lang];
      expect(minimum).toBeLessThan(CURATED_LIST_MIN_ENTRIES);
      expect(getCuratedList(listId).entries[locale].length, `${key}: back to five, remove the exception`).toBeLessThan(CURATED_LIST_MIN_ENTRIES);
    }
  });

  it.each(CURATED_LIST_IDS.flatMap((id) => SUPPORTED_LANGS.map((locale) => [id, locale] as const)))(
    "gives %s 5 to 8 entries in %s",
    (listId, locale) => {
      const count = getCuratedList(listId).entries[locale].length;
      expect(count).toBeGreaterThanOrEqual(MIN_ENTRIES_EXCEPTIONS[`${listId}/${locale}`] ?? CURATED_LIST_MIN_ENTRIES);
      expect(count).toBeLessThanOrEqual(CURATED_LIST_MAX_ENTRIES);
    },
  );

  it("fills every field of every entry", () => {
    for (const item of allEntries) {
      const { listId, entry } = item;
      for (const field of ["name", "url", "language", "audience", "value", "evidence"] as const) {
        expect(entry[field].trim(), `${label(item)} ${field}`).not.toBe("");
      }
      expect(entry.format, label(item)).toBe(getCuratedList(listId).format);
      expect(entry.language, label(item)).toMatch(/^[a-z]{2}(-[A-Z]{2})?$/);
      expect(entry.audience.length, label(item)).toBeLessThanOrEqual(140);
      expect(entry.value.length, label(item)).toBeLessThanOrEqual(170);
    }
  });

  it("links each entry's own https address, with no query, fragment or tracking", () => {
    for (const item of allEntries) {
      const url = new URL(item.entry.url);
      expect(url.protocol, label(item)).toBe("https:");
      expect(item.entry.url, label(item)).not.toMatch(TRACKING);
      expect(url.search + url.hash, label(item)).toBe("");
      expect(new URL(item.entry.evidence).protocol, label(item)).toBe("https:");
    }
  });

  it("lists an entry once per list and locale", () => {
    for (const listId of CURATED_LIST_IDS) {
      for (const locale of SUPPORTED_LANGS) {
        const entries = getCuratedList(listId).entries[locale];
        expect(new Set(entries.map(({ url }) => url)).size).toBe(entries.length);
        expect(new Set(entries.map(({ name }) => name.toLowerCase())).size).toBe(entries.length);
      }
    }
  });

  it("keeps only entries that published in the six months before they were checked", () => {
    for (const item of allEntries) {
      const { entry, listId } = item;
      expect(entry.checked, label(item)).toMatch(isoDate);
      expect(entry.lastPublished, label(item)).toMatch(isoDate);
      expect(day(entry.lastPublished), label(item)).toBeLessThanOrEqual(day(entry.checked));
      expect(day(entry.checked) - day(entry.lastPublished), label(item)).toBeLessThanOrEqual(CURATED_LIST_STALE_AFTER_DAYS * DAY);
      expect(day(entry.checked), label(item)).toBeLessThanOrEqual(day(getCuratedList(listId).reviewed));
    }
  });

  it("links related pages that exist, and Portuguese calculators from the Portuguese list only", () => {
    for (const item of allEntries) {
      const { entry, locale } = item;
      const related = entry.related;
      if (!related) continue;
      if ("tool" in related) {
        expect(() => getToolCatalogEntry(related.tool), label(item)).not.toThrow();
        if (related.tool !== "pageFireCalculator") expect(TOOL_ROUTE_IDS, label(item)).toContain(related.tool);
        if (locale !== "pt") expect(PORTUGAL_ONLY.has(related.tool), label(item)).toBe(false);
      } else if ("page" in related) {
        expect(locale, label(item)).toBe("pt");
        expect(existsSync(new URL(`.${toLocalizedPath(related.page, locale)}.astro`, pagesDir)), label(item)).toBe(true);
      } else {
        expect(existsSync(new URL(`${locale}/${related.guide}.md`, guidesDir)), label(item)).toBe(true);
      }
    }
  });

  it("writes the lines without rankings or audience sizes, in each locale's form of address", () => {
    for (const item of allEntries) {
      const { entry, locale } = item;
      const text = `${entry.audience} ${entry.value}`;
      expect(text, label(item)).not.toMatch(RANKING_WORDS);
      if (locale === "pt") expect(text, label(item)).not.toMatch(/\b(você|vocês|seu|sua|seus|suas)\b/iu);
      if (locale === "de") expect(text, label(item)).not.toMatch(/(?<!\p{L})(du|dein\p{L}*|dir|dich|euch|euer|eure\p{L}*)(?!\p{L})/iu);
      if (locale === "es") expect(text, label(item)).not.toMatch(/\busted(es)?\b/iu);
      if (locale === "fr") {
        expect(text, label(item)).not.toMatch(/(?<!\p{L})(tu|ton|ta|tes|toi)(?!\p{L})/iu);
        expect(text, label(item)).not.toMatch(/ [:;?!%€]|[^\s\u00a0][:;?!](?=\s|$)/u);
      }
      if (locale === "it") expect(text, label(item)).not.toMatch(/\b(Lei può|Suo|Sua)\b/u);
    }
  });

  it("sorts entries alphabetically, not by rank", () => {
    const names = curatedEntries(getCuratedList("podcasts"), "en").map(({ name }) => name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" })));
  });

  it("calls a list stale after about six months", () => {
    const reviewed = "2026-11-20";
    const after = (days: number) => new Date(day(reviewed) + days * DAY);
    expect(daysSinceCuratedReview(reviewed, after(10))).toBe(10);
    expect(isCuratedListStale(reviewed, after(CURATED_LIST_STALE_AFTER_DAYS))).toBe(false);
    expect(isCuratedListStale(reviewed, after(CURATED_LIST_STALE_AFTER_DAYS + 1))).toBe(true);
    for (const id of CURATED_LIST_IDS) expect(getCuratedList(id).reviewed).toMatch(isoDate);
  });
});

describe("curated list pages", () => {
  it.each(SUPPORTED_LANGS)("has one prerendered route file in %s, under the resources slug", (locale) => {
    const file = new URL(`${locale}/${getLocalizedSlug("pageResources", locale)}/[list].astro`, pagesDir);
    expect(existsSync(file)).toBe(true);
    const source = readFileSync(file, "utf8");
    expect(source).toContain("export const prerender = true");
    expect(source).toContain(`getCuratedListStaticPaths("${locale}")`);
  });

  it.each(SUPPORTED_LANGS)("publishes every list at its localized address in %s", (locale) => {
    const paths = getCuratedListStaticPaths(locale);
    expect(paths.map(({ props }) => props.listId)).toEqual(CURATED_LIST_IDS);
    for (const { params, props } of paths) {
      const { routeId } = getCuratedList(props.listId);
      const path = toLocalizedPath(routeId, locale);
      const href = `https://wonder.money${path}`;
      expect(path).toBe(`/${locale}/${getLocalizedSlug("pageResources", locale)}/${params.list}`);
      expect(buildAlternateLinks(routeId)).toContainEqual({ hrefLang: locale, href });
      expect(isSitemapPage(href)).toBe(true);
      for (const other of SUPPORTED_LANGS) expect(toLocalizedPathname(path, other)).toBe(toLocalizedPath(routeId, other));
    }
  });

  it("still maps the resources hub itself when switching language", () => {
    expect(toLocalizedPathname("/pt/recursos", "de")).toBe("/de/ressourcen");
    expect(toLocalizedPathname("/en/resources/unknown", "fr")).toBe("/fr/ressources/unknown");
  });

  it.each(SUPPORTED_LANGS)("links every list from the resources hub in %s", (locale) => {
    const hub = buildResourcesHub(locale);
    for (const id of CURATED_LIST_IDS) {
      const card = hub.find(({ destination }) => destination === `list_${id}`);
      expect(card?.href).toBe(toLocalizedPath(getCuratedList(id).routeId, locale));
      expect(card?.figure).toBe(getCuratedList(id).figure);
    }
  });

  it.each(CURATED_LIST_IDS.flatMap((id) => SUPPORTED_LANGS.map((locale) => [id, locale] as const)))(
    "renders the %s page in %s with all its copy",
    (listId, locale) => {
      const t = getTranslations(locale);
      const page = buildCuratedListPage({ listId, locale, t, guideTitles: guideTitles(locale), now: new Date(day(getCuratedList(listId).reviewed)) });
      const texts = [
        page.metaTitle,
        page.metaDescription,
        page.title,
        page.dek,
        page.listTitle,
        page.reviewedBadge,
        page.stale.title,
        page.stale.text,
        page.how.title,
        page.how.intro,
        ...page.how.criteria,
        page.how.order,
        page.how.owner,
        ...Object.values(page.labels),
        page.practice.title,
        page.practice.intro,
        ...page.entries.flatMap((entry) => [entry.meta, entry.dates]),
      ];
      for (const text of texts) {
        expect(text.trim()).not.toBe("");
        expect(text).not.toMatch(/\{\{|curatedLists\./);
      }
      expect(page.how.criteria).toHaveLength(CURATED_CRITERIA.length);
      expect(page.stale.atBuild).toBe(false);
      expect(page.entries).toHaveLength(getCuratedList(listId).entries[locale].length);
      expect(page.structuredData.mainEntity.itemListElement.map(({ url }) => url)).toEqual(page.entries.map(({ url }) => url));
      expect(page.practice.cards.length).toBeLessThanOrEqual(3);
      for (const card of [...page.practice.cards, ...page.otherLists]) expect(card.href.startsWith(`/${locale}/`)).toBe(true);
      expect(page.otherLists.map(({ href }) => href)).not.toContain(toLocalizedPath(getCuratedList(listId).routeId, locale));
    },
  );

  it.each(["metaTitle", "metaDescription", "title"])("gives each list a distinct %s in every locale", (key) => {
    const values = CURATED_LIST_IDS.flatMap((id) => SUPPORTED_LANGS.map((locale) => getTranslations(locale)(`curatedLists.lists.${id}.${key}`)));
    expect(new Set(values).size).toBe(values.length);
  });

  it("keeps the same copy keys in every locale, in src and public catalogues alike", () => {
    const keys = (value: unknown, prefix = ""): string[] =>
      typeof value === "object" && value !== null
        ? Object.entries(value).flatMap(([key, child]) => keys(child, `${prefix}${key}.`))
        : [prefix];
    const read = (base: string, locale: Lang) =>
      JSON.parse(readFileSync(new URL(`../../../../${base}/${locale}/common.json`, import.meta.url), "utf8")).curatedLists;
    const reference = keys(read("src/locales", "en")).sort();
    for (const locale of SUPPORTED_LANGS) {
      expect(keys(read("src/locales", locale)).sort()).toEqual(reference);
      expect(read("public/locales", locale)).toEqual(read("src/locales", locale));
    }
  });

  it("puts a no-break space before French high punctuation in the page copy", () => {
    const strings = (value: unknown): string[] =>
      typeof value === "string" ? [value] : Object.values(value as object).flatMap(strings);
    const fr = JSON.parse(readFileSync(new URL("../../../locales/fr/common.json", import.meta.url), "utf8")).curatedLists;
    for (const text of strings(fr)) expect(text).not.toMatch(/ [:;?!%€]|[^\s\u00a0][:;?!](?=\s|$)/u);
  });
});
