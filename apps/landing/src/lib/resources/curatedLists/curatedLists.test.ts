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
  CURATED_EVENTS_MIN_PROGRAMMES,
  CURATED_LIST_IDS,
  CURATED_LIST_MAX_ENTRIES,
  CURATED_LIST_MIN_ENTRIES,
  CURATED_LIST_STALE_AFTER_DAYS,
  CURATED_LISTS,
  CURATED_REVIEW_DAYS,
  curatedEntries,
  daysSinceCuratedReview,
  getCuratedList,
  getCuratedListByRouteId,
  isCuratedListStale,
  isUpcomingEvent,
  type CuratedEntry,
  type CuratedListId,
} from "./index";
import { buildCuratedListPage } from "./page";

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

// A community must have had a post this many days before it was checked ("in the last month"),
// and a recurring programme an edition within this many days, unless its next one is announced.
const FORUM_ACTIVE_DAYS = 31;
const PROGRAMME_HELD_DAYS = 396;

// Shops and catalogues a book must not link: its publisher's own page instead.
const RETAILERS = /(^|\.)(amazon|fnac|wook|bertrand|thalia|hugendubel|casadellibro|ibs|lafeltrinelli|mondadoristore|waterstones|blackwells|bookshop|goodreads|books\.google|decitre|cultura|kobo|elcorteingles|libreriauniversitaria|weltbild|orellfuessli|exlibris)\./i;

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

/** The lines of an entry we write ourselves, beyond its audience and value. */
const ownLines = (entry: CuratedEntry): string[] => {
  switch (entry.format) {
    case "forum":
      return [entry.moderation];
    case "course":
      return entry.duration ? [entry.duration] : [];
    case "programme":
      return [entry.when];
    case "event":
      return [entry.where];
    default:
      return [];
  }
};

const LISTS_WITH_EVENTS = CURATED_LIST_IDS.filter((id) => getCuratedList(id).formats.includes("event"));
const LISTS_OF_FIVE = CURATED_LIST_IDS.filter((id) => !LISTS_WITH_EVENTS.includes(id));

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
    // On 2026-11-20 the Literacia Financeira Discord could not be read without joining, and the
    // other Portuguese communities were Brazilian, closed or run by a commercial firm. Remove when
    // another qualifying community turns up.
    "forums/pt": 4,
    // On 2026-11-20 the other Italian communities had no written rules (r/FireIT), were off topic
    // (r/Avvocati) or could not be checked (FinanzaOnline and PensioniOggi block automated
    // access). Remove when another qualifying community turns up.
    "forums/it": 4,
    // The Politecnico di Milano's free "Finanza per tutti" qualified on 2026-11-20 but has no
    // address without a query string; no other public Italian course was open. Remove when it,
    // or another qualifying course, has one.
    "courses/it": 4,
  };

  it("keeps each minimum-count exception below the usual minimum, so a stale one is noticed", () => {
    for (const [key, minimum] of Object.entries(MIN_ENTRIES_EXCEPTIONS)) {
      const [listId, locale] = key.split("/") as [keyof typeof CURATED_LISTS, Lang];
      expect(minimum).toBeLessThan(CURATED_LIST_MIN_ENTRIES);
      expect(getCuratedList(listId).entries[locale].length, `${key}: back to five, remove the exception`).toBeLessThan(CURATED_LIST_MIN_ENTRIES);
    }
  });

  it.each(LISTS_OF_FIVE.flatMap((id) => SUPPORTED_LANGS.map((locale) => [id, locale] as const)))(
    "gives %s 5 to 8 entries in %s",
    (listId, locale) => {
      const count = getCuratedList(listId).entries[locale].length;
      expect(count).toBeGreaterThanOrEqual(MIN_ENTRIES_EXCEPTIONS[`${listId}/${locale}`] ?? CURATED_LIST_MIN_ENTRIES);
      expect(count).toBeLessThanOrEqual(CURATED_LIST_MAX_ENTRIES);
    },
  );

  // Dated events expire and may be few, so the events list counts its recurring programmes,
  // which keep the page useful when no dated event is coming up.
  it.each(LISTS_WITH_EVENTS.flatMap((id) => SUPPORTED_LANGS.map((locale) => [id, locale] as const)))(
    "gives %s at least three recurring programmes and at most 8 of each kind in %s",
    (listId, locale) => {
      const entries = getCuratedList(listId).entries[locale];
      const programmes = entries.filter(({ format }) => format === "programme").length;
      expect(programmes).toBeGreaterThanOrEqual(MIN_ENTRIES_EXCEPTIONS[`${listId}/${locale}`] ?? CURATED_EVENTS_MIN_PROGRAMMES);
      expect(programmes).toBeLessThanOrEqual(CURATED_LIST_MAX_ENTRIES);
      expect(entries.length - programmes).toBeLessThanOrEqual(CURATED_LIST_MAX_ENTRIES);
    },
  );

  it("fills every field of every entry", () => {
    for (const item of allEntries) {
      const { listId, entry } = item;
      for (const field of ["name", "url", "language", "audience", "value", "evidence"] as const) {
        expect(entry[field].trim(), `${label(item)} ${field}`).not.toBe("");
      }
      expect(getCuratedList(listId).formats, label(item)).toContain(entry.format);
      expect(entry.language, label(item)).toMatch(/^[a-z]{2}(-[A-Z]{2})?$/);
      expect(entry.audience.length, label(item)).toBeLessThanOrEqual(140);
      expect(entry.value.length, label(item)).toBeLessThanOrEqual(170);
      for (const line of ownLines(entry)) {
        expect(line.trim(), label(item)).not.toBe("");
        expect(line.length, label(item)).toBeLessThanOrEqual(170);
      }
      if (entry.format === "book") {
        expect(entry.author.trim(), label(item)).not.toBe("");
        expect(entry.publisher.trim(), label(item)).not.toBe("");
        expect(entry.year, label(item)).toBeGreaterThanOrEqual(1900);
        expect(entry.year, label(item)).toBeLessThanOrEqual(new Date(day(entry.checked)).getUTCFullYear());
        expect(new URL(entry.url).hostname, label(item)).not.toMatch(RETAILERS);
      }
      if (entry.format === "course") {
        expect(entry.provider.trim(), label(item)).not.toBe("");
        if (entry.price !== "free") expect(entry.price.amount, label(item)).toBeGreaterThan(0);
      }
      if (entry.format === "event" || entry.format === "programme") expect(entry.organiser.trim(), label(item)).not.toBe("");
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

  it("keeps only entries that were active when they were checked", () => {
    for (const item of allEntries) {
      const { entry, listId } = item;
      const reviewed = getCuratedList(listId).reviewed;
      expect(entry.checked, label(item)).toMatch(isoDate);
      expect(day(entry.checked), label(item)).toBeLessThanOrEqual(day(reviewed));
      const within = (date: string, days: number) => {
        expect(date, label(item)).toMatch(isoDate);
        expect(day(date), label(item)).toBeLessThanOrEqual(day(entry.checked));
        expect(day(entry.checked) - day(date), label(item)).toBeLessThanOrEqual(days * DAY);
      };
      switch (entry.format) {
        case "podcast":
        case "newsletter":
        case "youtube":
          within(entry.lastPublished, CURATED_LIST_STALE_AFTER_DAYS);
          break;
        case "forum":
          within(entry.lastPublished, FORUM_ACTIVE_DAYS);
          break;
        case "programme":
          if (entry.next) {
            expect(entry.next.starts <= entry.next.ends, label(item)).toBe(true);
            expect(entry.next.ends >= entry.checked, label(item)).toBe(true);
          }
          if (!entry.next) within(entry.lastHeld ?? "", PROGRAMME_HELD_DAYS);
          else if (entry.lastHeld) expect(entry.lastHeld <= entry.checked, label(item)).toBe(true);
          break;
        case "event":
          expect(entry.starts, label(item)).toMatch(isoDate);
          expect(entry.ends, label(item)).toMatch(isoDate);
          expect(entry.starts <= entry.ends, label(item)).toBe(true);
          // Listed only while still to come at the review: past ones are removed then.
          expect(entry.ends >= reviewed, label(item)).toBe(true);
          break;
      }
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
      const text = [entry.audience, entry.value, ...ownLines(entry)].join(" ");
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

  it("sorts entries alphabetically, not by rank, and dated events by their start", () => {
    const names = curatedEntries(getCuratedList("podcasts"), "en").map(({ name }) => name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" })));
    for (const locale of SUPPORTED_LANGS) {
      const starts = curatedEntries(getCuratedList("events"), locale).flatMap((entry) => (entry.format === "event" ? [entry.starts] : []));
      expect(starts).toEqual([...starts].sort());
    }
  });

  it("calls a list stale after about six months, and the events list after six weeks", () => {
    const reviewed = "2026-11-20";
    const after = (days: number) => new Date(day(reviewed) + days * DAY);
    expect(daysSinceCuratedReview(reviewed, after(10))).toBe(10);
    expect(isCuratedListStale(reviewed, after(CURATED_LIST_STALE_AFTER_DAYS))).toBe(false);
    expect(isCuratedListStale(reviewed, after(CURATED_LIST_STALE_AFTER_DAYS + 1))).toBe(true);
    expect(isCuratedListStale(reviewed, after(CURATED_REVIEW_DAYS.monthly), "monthly")).toBe(false);
    expect(isCuratedListStale(reviewed, after(CURATED_REVIEW_DAYS.monthly + 1), "monthly")).toBe(true);
    expect(getCuratedList("events").review).toBe("monthly");
    for (const id of CURATED_LIST_IDS) expect(getCuratedList(id).reviewed).toMatch(isoDate);
  });

  it("keeps a dated event until the end of its last day", () => {
    const event = { ends: "2026-12-03" } as const;
    expect(isUpcomingEvent(event, new Date("2026-12-03T23:30:00Z"))).toBe(true);
    expect(isUpcomingEvent(event, new Date("2026-12-04T00:00:00Z"))).toBe(false);
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
        ...page.sections.flatMap((section) => [section.title, ...(section.empty === undefined ? [] : [section.empty])]),
        ...page.entries.flatMap((entry) => (entry.details ? [entry.details.label, entry.details.text] : [])),
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
      expect(page.how.criteria).toHaveLength(getCuratedList(listId).criteria.length);
      expect(page.stale.atBuild).toBe(false);
      expect(page.entries).toHaveLength(getCuratedList(listId).entries[locale].length);
      expect(page.structuredData.mainEntity.itemListElement.map(({ url }) => url)).toEqual(page.entries.map(({ url }) => url));
      expect(page.practice.cards.length).toBeLessThanOrEqual(3);
      for (const card of [...page.practice.cards, ...page.otherLists]) expect(card.href.startsWith(`/${locale}/`)).toBe(true);
      expect(page.otherLists.map(({ href }) => href)).not.toContain(toLocalizedPath(getCuratedList(listId).routeId, locale));
    },
  );

  it.each(SUPPORTED_LANGS)("leaves past events off the events page in %s and says so when none is left", (locale) => {
    const t = getTranslations(locale);
    const list = getCuratedList("events");
    const events = list.entries[locale].flatMap((entry) => (entry.format === "event" ? [entry] : []));
    const build = (now: Date) => buildCuratedListPage({ listId: "events", locale, t, guideTitles: guideTitles(locale), now });
    const [upcoming, programmes] = build(new Date(day(list.reviewed))).sections;
    expect(upcoming.id).toBe("curated-events");
    expect(upcoming.entries.map(({ url }) => url)).toEqual(curatedEntries(list, locale).flatMap((entry) => (entry.format === "event" ? [entry.url] : [])));
    expect(programmes.entries.every(({ format }) => format === "programme")).toBe(true);
    for (const entry of upcoming.entries) expect(entry.ends).toMatch(isoDate);

    const later = build(new Date(day("2099-01-01")));
    expect(later.sections[0].entries).toEqual([]);
    expect(later.sections[0].empty).toBe(t("curatedLists.lists.events.noUpcoming"));
    expect(later.sections[1].entries).toHaveLength(programmes.entries.length);
    expect(later.entries).toHaveLength(programmes.entries.length);
    expect(later.stale.atBuild).toBe(true);
    expect(later.stale.text).toContain(later.reviewedBadge.match(/\d{4}/)?.[0] ?? "");
    expect(events.length).toBe(upcoming.entries.length);
  });

  it("links the other lists in hub order, wrapping round", () => {
    const t = getTranslations("en");
    const last = CURATED_LIST_IDS.at(-1) as CuratedListId;
    const page = buildCuratedListPage({ listId: last, locale: "en", t, guideTitles: guideTitles("en"), now: new Date(day(getCuratedList(last).reviewed)) });
    expect(page.otherLists.map(({ href }) => href)).toEqual(CURATED_LIST_IDS.slice(0, 3).map((id) => toLocalizedPath(getCuratedList(id).routeId, "en")));
  });

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
