/**
 * The curated resource lists, their pages and the links they lead to. A list is a module in this
 * directory (see `types.ts`), registered in CURATED_LISTS with a route id from
 * CURATED_LIST_ROUTE_IDS (src/lib/routes.ts); the page is CuratedListPage.astro, served by
 * `src/pages/{lang}/{resources}/[list].astro`.
 */
import type { FigureCard } from "../../figureCards";
import { figureForGuide, figureForTool, PAGE_FIGURES } from "../../hairline/articleFigures";
import type { Lang } from "../../i18nLocale";
import { toIntlLocale } from "../../numberFormat";
import { toLocalizedPath, type CuratedListRouteId } from "../../routes";
import { getToolCatalogEntry } from "../../toolsCatalog";
import type { Translate } from "../../translations";
import { BOOKS } from "./books";
import { COURSES } from "./courses";
import { EVENTS } from "./events";
import { FORUMS } from "./forums";
import { NEWSLETTERS } from "./newsletters";
import { PODCASTS } from "./podcasts";
import type { CuratedEntry, CuratedEventEntry, CuratedList, CuratedRelated, IsoDate } from "./types";
import { YOUTUBE } from "./youtube";

export type * from "./types";

export const CURATED_LISTS = {
  podcasts: PODCASTS,
  newsletters: NEWSLETTERS,
  youtube: YOUTUBE,
  books: BOOKS,
  courses: COURSES,
  forums: FORUMS,
  events: EVENTS,
} as const satisfies Record<string, CuratedList>;

export type CuratedListId = keyof typeof CURATED_LISTS;

/** In the order the resources hub lists them. */
export const CURATED_LIST_IDS = Object.keys(CURATED_LISTS) as CuratedListId[];

/** Entries per locale a list must have. */
export const CURATED_LIST_MIN_ENTRIES = 5;
export const CURATED_LIST_MAX_ENTRIES = 8;

/**
 * The events list instead holds at least this many recurring programmes per locale, which do not
 * expire, so its page is never empty, and up to CURATED_LIST_MAX_ENTRIES of each kind.
 */
export const CURATED_EVENTS_MIN_PROGRAMMES = 3;

/** A list unreviewed for longer than this, by its cadence, shows a note that it is due for review. */
export const CURATED_REVIEW_DAYS = { halfYearly: 183, monthly: 45 } as const satisfies Record<CuratedList["review"], number>;

/** The half-yearly cadence: also the most a podcast, newsletter or channel may have gone quiet. */
export const CURATED_LIST_STALE_AFTER_DAYS = CURATED_REVIEW_DAYS.halfYearly;

export function getCuratedList(id: CuratedListId): CuratedList {
  return CURATED_LISTS[id];
}

export function getCuratedListByRouteId(routeId: CuratedListRouteId): CuratedList & { id: CuratedListId } {
  const id = CURATED_LIST_IDS.find((candidate) => CURATED_LISTS[candidate].routeId === routeId);
  if (!id) throw new Error(`No curated list for route ${routeId}`);
  return { ...CURATED_LISTS[id], id };
}

/** A locale's entries in alphabetical order: the lists do not rank. Dated events come by start date. */
export function curatedEntries(list: CuratedList, locale: Lang): CuratedEntry[] {
  const collator = new Intl.Collator(toIntlLocale(locale), { sensitivity: "base" });
  const startOf = (entry: CuratedEntry) => (entry.format === "event" ? entry.starts : "");
  return [...list.entries[locale]].sort((a, b) => startOf(a).localeCompare(startOf(b)) || collator.compare(a.name, b.name));
}

/** `now` as an ISO date, in UTC. */
export function isoDay(now: Date): IsoDate {
  return now.toISOString().slice(0, 10) as IsoDate;
}

/** A dated event shows until the end of its last day. */
export function isUpcomingEvent(entry: Pick<CuratedEventEntry, "ends">, now: Date): boolean {
  return entry.ends >= isoDay(now);
}

/** Whole days from `reviewed` to `now`. */
export function daysSinceCuratedReview(reviewed: string, now: Date): number {
  return Math.floor((now.getTime() - Date.parse(`${reviewed}T00:00:00Z`)) / 86_400_000);
}

export function isCuratedListStale(reviewed: string, now: Date, review: CuratedList["review"] = "halfYearly"): boolean {
  return daysSinceCuratedReview(reviewed, now) > CURATED_REVIEW_DAYS[review];
}

/** The path of a related learn guide, which exists in en and pt only. */
export function relatedGuidePath(locale: Lang, slug: string): string {
  return `/${locale}/learn/${slug}`;
}

/**
 * The card of the WonderMoney page an entry leads to. A learn guide's title comes from its
 * content entry, so the page passes `guideTitles` (slug to title); a missing one throws.
 */
export function relatedCard(
  related: CuratedRelated,
  locale: Lang,
  t: Translate,
  guideTitles: ReadonlyMap<string, string> = new Map(),
): FigureCard {
  if ("tool" in related) {
    const { key } = getToolCatalogEntry(related.tool);
    return {
      href: toLocalizedPath(related.tool, locale),
      title: t(`tools.${key}.title`),
      figure: figureForTool(related.tool),
      kind: t("global.relatedContent.calculator"),
    };
  }
  if ("page" in related) {
    return {
      href: toLocalizedPath(related.page, locale),
      title: t("savingsGuide.title"),
      figure: PAGE_FIGURES.pageSavingsGuide,
      kind: t("global.relatedContent.guide"),
    };
  }
  const title = guideTitles.get(related.guide);
  if (!title) throw new Error(`No ${locale} learn guide with the slug ${related.guide}`);
  return {
    href: relatedGuidePath(locale, related.guide),
    title,
    figure: figureForGuide(related.guide) ?? PAGE_FIGURES.learnHub,
    kind: t("global.relatedContent.guide"),
  };
}

/** The resources hub's cards for the lists. */
export function curatedListHubCards(locale: Lang, t: Translate) {
  return CURATED_LIST_IDS.map((id) => ({
    destination: `list_${id}`,
    href: toLocalizedPath(CURATED_LISTS[id].routeId, locale),
    title: t(`curatedLists.lists.${id}.title`),
    description: t(`curatedLists.lists.${id}.hubDescription`),
    figure: CURATED_LISTS[id].figure,
  }));
}
