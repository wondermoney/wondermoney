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
  curatedEntries,
  getCuratedList,
  isCuratedListStale,
  relatedCard,
  type CuratedListId,
} from "./index";

/** The rules every entry meets, in the order the page lists them (`curatedLists.common.criteria.*`). */
export const CURATED_CRITERIA = ["active", "independent", "noHype", "free", "market"] as const;

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
  now?: Date;
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
  const k = (key: string) => t(`curatedLists.lists.${listId}.${key}`);
  const c = (key: string, options?: Record<string, unknown>) => t(`curatedLists.common.${key}`, options);
  const intlLocale = toIntlLocale(locale);
  const languageNames = new Intl.DisplayNames([intlLocale], { type: "language" });
  const languageName = (tag: string) => {
    const name = languageNames.of(tag) ?? tag;
    return name.charAt(0).toLocaleUpperCase(intlLocale) + name.slice(1);
  };
  const reviewed = formatCheckedDate(locale, list.reviewed);
  const canonicalUrl = `${origin}${toLocalizedPath(list.routeId, locale)}`;

  const entries = curatedEntries(list, locale).map((entry) => ({
    name: entry.name,
    url: entry.url,
    meta: `${c(`formats.${entry.format}`)} · ${languageName(entry.language)}`,
    audience: entry.audience,
    value: entry.value,
    related: entry.related ? relatedCard(entry.related, locale, t, guideTitles) : undefined,
    relatedKind: entry.related ? (Object.keys(entry.related)[0] as "tool" | "page" | "guide") : undefined,
    dates: `${t(`curatedLists.lists.${listId}.latest`, { date: formatCheckedDate(locale, entry.lastPublished) })} · ${c("checked", { date: formatCheckedDate(locale, entry.checked) })}`,
  }));

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

  const otherLists: FigureCard[] = CURATED_LIST_IDS.filter((id) => id !== listId)
    .slice(0, MAX_OTHER_LISTS)
    .map((id) => ({
      href: toLocalizedPath(getCuratedList(id).routeId, locale),
      title: t(`curatedLists.lists.${id}.title`),
      figure: getCuratedList(id).figure,
      kind: t("footer.resources"),
    }));

  const outline = [
    { id: "curated-how", title: c("howTitle") },
    { id: "curated-list", title: k("listTitle") },
    ...(practice.length > 0 ? [{ id: "curated-practice", title: c("practiceTitle") }] : []),
  ];

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
      atBuild: isCuratedListStale(list.reviewed, now),
      title: c("staleTitle"),
      text: c("stale", { date: reviewed }),
    },
    how: {
      title: c("howTitle"),
      intro: c("howIntro"),
      criteria: CURATED_CRITERIA.map((criterion) => c(`criteria.${criterion}`)),
      order: c("order"),
      owner: c("owner"),
    },
    labels: { audience: c("audience"), value: c("value"), applyIt: c("applyIt") },
    entries,
    practice: { title: c("practiceTitle"), intro: c("practiceIntro"), cards: practice },
    otherLists,
    outline,
    structuredData,
  };
}

export type CuratedListPageModel = ReturnType<typeof buildCuratedListPage>;
