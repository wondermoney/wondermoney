/**
 * Everything CuratedListPage.astro renders, built from a list and the locale's copy, so the page
 * is a template and its content is testable without Astro.
 */
import { formatCheckedDate } from "../../calculators/brokerFeesFormat";
import type { FigureCard } from "../../figureCards";
import type { Lang } from "../../i18nLocale";
import { toIntlLocale } from "../../numberFormat";
import { toLocalizedPath } from "../../routes";
import type { Translate } from "../../translations";
import {
  CURATED_LIST_IDS,
  CURATED_REVIEW_DAYS,
  curatedEntries,
  getCuratedList,
  isCuratedListStale,
  isUpcomingEvent,
  relatedCard,
  type CuratedListId,
} from "./index";
import type { CoursePrice, CuratedEntry } from "./types";

const MAX_PRACTICE = 3;
const MAX_OTHER_LISTS = 3;

export interface CuratedListPageInput {
  listId: CuratedListId;
  locale: Lang;
  t: Translate;
  /** The locale's learn guides, slug to title, for entries that link one. */
  guideTitles?: ReadonlyMap<string, string>;
  /** The site origin of the canonical URL. */
  origin?: string;
  /** The build's date: dated events that ended before it are left out. */
  now?: Date;
}

export interface CuratedEntryCard {
  name: string;
  url: string;
  format: CuratedEntry["format"];
  /** What it is and its language, or its author, provider or organiser. */
  meta: string;
  audience: string;
  value: string;
  /** A third line where the format has one: moderation, edition, level and cost, or when. */
  details?: { label: string; text: string };
  related?: FigureCard;
  relatedKind?: "tool" | "page" | "guide";
  /** When it last published and when we checked it. */
  dates: string;
  /** A dated event's last day, for hiding it in the browser once it has passed. */
  ends?: string;
}

export interface CuratedSection {
  id: string;
  title: string;
  entries: CuratedEntryCard[];
  /** Shown when a section of dated events has nothing upcoming. */
  empty?: string;
}

export function buildCuratedListPage({
  listId,
  locale,
  t,
  guideTitles = new Map(),
  origin = "https://wonder.money",
  now = new Date(),
}: CuratedListPageInput) {
  const list = getCuratedList(listId);
  const k = (key: string, options?: Record<string, unknown>) => t(`curatedLists.lists.${listId}.${key}`, options);
  const c = (key: string, options?: Record<string, unknown>) => t(`curatedLists.common.${key}`, options);
  const intlLocale = toIntlLocale(locale);
  const capitalize = (text: string) => text.charAt(0).toLocaleUpperCase(intlLocale) + text.slice(1);
  const languageNames = new Intl.DisplayNames([intlLocale], { type: "language" });
  const languageName = (tag: string) => capitalize(languageNames.of(tag) ?? tag);
  const date = (iso: string) => formatCheckedDate(locale, iso);
  const range = (starts: string, ends: string) => (starts === ends ? date(starts) : `${date(starts)} – ${date(ends)}`);
  const price = (value: CoursePrice) =>
    value === "free"
      ? c("free")
      : new Intl.NumberFormat(intlLocale, {
          style: "currency",
          currency: value.currency,
          maximumFractionDigits: Number.isInteger(value.amount) ? 0 : 2,
        }).format(value.amount);
  const reviewed = date(list.reviewed);
  const canonicalUrl = `${origin}${toLocalizedPath(list.routeId, locale)}`;
  const checked = (entry: CuratedEntry) => c("checked", { date: date(entry.checked) });

  const toCard = (entry: CuratedEntry): CuratedEntryCard => {
    const base = {
      name: entry.name,
      url: entry.url,
      format: entry.format,
      audience: entry.audience,
      value: entry.value,
      related: entry.related ? relatedCard(entry.related, locale, t, guideTitles) : undefined,
      relatedKind: entry.related ? (Object.keys(entry.related)[0] as "tool" | "page" | "guide") : undefined,
    };
    switch (entry.format) {
      case "podcast":
      case "newsletter":
      case "youtube":
        return {
          ...base,
          meta: `${c(`formats.${entry.format}`)} · ${languageName(entry.language)}`,
          dates: `${k("latest", { date: date(entry.lastPublished) })} · ${checked(entry)}`,
        };
      case "forum":
        return {
          ...base,
          meta: `${c(`platforms.${entry.platform}`)} · ${languageName(entry.language)}`,
          details: { label: c("moderation"), text: entry.moderation },
          dates: `${k("latest", { date: date(entry.lastPublished) })} · ${checked(entry)}`,
        };
      case "book":
        return {
          ...base,
          meta: `${c("formats.book")} · ${entry.author}`,
          details: {
            label: c("edition"),
            text: [`${entry.publisher}, ${entry.year}`, entry.originalTitle && c("translatedFrom", { title: entry.originalTitle })]
              .filter(Boolean)
              .join(" · "),
          },
          dates: capitalize(checked(entry)),
        };
      case "course":
        return {
          ...base,
          meta: `${entry.provider} · ${languageName(entry.language)}`,
          details: {
            label: c("courseFacts"),
            text: [c(`levels.${entry.level}`), c(`deliveries.${entry.delivery}`), entry.duration, price(entry.price)]
              .filter(Boolean)
              .join(" · "),
          },
          dates: capitalize(checked(entry)),
        };
      case "programme":
        return {
          ...base,
          meta: entry.organiser,
          details: {
            label: c("when"),
            text: entry.next ? `${entry.when} · ${c("nextEdition", { dates: range(entry.next.starts, entry.next.ends) })}` : entry.when,
          },
          dates: entry.lastHeld ? `${c("lastHeld", { date: date(entry.lastHeld) })} · ${checked(entry)}` : capitalize(checked(entry)),
        };
      case "event":
        return {
          ...base,
          meta: `${entry.organiser} · ${entry.where}`,
          details: { label: c("when"), text: range(entry.starts, entry.ends) },
          dates: capitalize(checked(entry)),
          ends: entry.ends,
        };
    }
  };

  const all = curatedEntries(list, locale);
  // The events list: the dated events still to come, by start date, then the recurring
  // programmes, which stand in when no dated event is coming up.
  const sections: CuratedSection[] = list.formats.includes("event")
    ? [
        {
          id: "curated-events",
          title: k("listTitle"),
          entries: all.filter((entry) => entry.format === "event" && isUpcomingEvent(entry, now)).map(toCard),
          empty: k("noUpcoming"),
        },
        {
          id: "curated-programmes",
          title: k("programmesTitle"),
          entries: all.filter((entry) => entry.format === "programme").map(toCard),
        },
      ]
    : [{ id: "curated-list", title: k("listTitle"), entries: all.map(toCard) }];
  const entries = sections.flatMap((section) => section.entries);

  // The calculators the entries lead to, the most often named first: one lesson, tried with your
  // own numbers. Guides stay on their entries.
  const counts = new Map<string, { card: FigureCard; count: number }>();
  for (const { related, relatedKind } of entries) {
    if (related && relatedKind !== "guide") {
      counts.set(related.href, { card: related, count: (counts.get(related.href)?.count ?? 0) + 1 });
    }
  }
  const practice = [...counts.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, MAX_PRACTICE)
    .map(({ card }) => card);

  // The lists after this one, in hub order, wrapping round.
  const position = CURATED_LIST_IDS.indexOf(listId);
  const otherLists: FigureCard[] = CURATED_LIST_IDS.map((_, offset) => CURATED_LIST_IDS[(position + offset + 1) % CURATED_LIST_IDS.length])
    .filter((id) => id !== listId)
    .slice(0, MAX_OTHER_LISTS)
    .map((id) => ({
      href: toLocalizedPath(getCuratedList(id).routeId, locale),
      title: t(`curatedLists.lists.${id}.title`),
      figure: getCuratedList(id).figure,
      kind: t("footer.resources"),
    }));

  const outline = [
    { id: "curated-how", title: c("howTitle") },
    ...sections.map(({ id, title }) => ({ id, title })),
    ...(practice.length > 0 ? [{ id: "curated-practice", title: c("practiceTitle") }] : []),
  ];

  const monthly = list.review === "monthly";
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: k("title"),
    description: k("metaDescription"),
    url: canonicalUrl,
    inLanguage: locale,
    dateModified: list.reviewed,
    publisher: { "@type": "Organization", name: "WonderMoney", url: "https://wonder.money" },
    mainEntity: {
      "@type": "ItemList",
      itemListOrder: "https://schema.org/ItemListUnordered",
      numberOfItems: entries.length,
      itemListElement: entries.map((entry, index) => ({
        "@type": "ListItem",
        position: index + 1,
        name: entry.name,
        url: entry.url,
      })),
    },
  };

  return {
    list,
    canonicalUrl,
    metaTitle: k("metaTitle"),
    metaDescription: k("metaDescription"),
    title: k("title"),
    dek: k("dek"),
    listTitle: k("listTitle"),
    reviewedBadge: c("reviewed", { date: reviewed }),
    stale: {
      atBuild: isCuratedListStale(list.reviewed, now, list.review),
      afterDays: CURATED_REVIEW_DAYS[list.review],
      title: c("staleTitle"),
      text: c(monthly ? "staleMonthly" : "stale", { date: reviewed }),
    },
    how: {
      title: c("howTitle"),
      intro: c("howIntro"),
      criteria: list.criteria.map((criterion) => c(`criteria.${criterion}`)),
      order: c(list.formats.includes("event") ? "orderEvents" : "order"),
      owner: c(monthly ? "ownerMonthly" : "owner"),
    },
    labels: { audience: c("audience"), value: c("value"), applyIt: c("applyIt") },
    sections,
    entries,
    practice: { title: c("practiceTitle"), intro: c("practiceIntro"), cards: practice },
    otherLists,
    outline,
    structuredData,
  };
}

export type CuratedListPageModel = ReturnType<typeof buildCuratedListPage>;
