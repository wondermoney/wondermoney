/**
 * The shape of a curated list of outside resources (podcasts, newsletters, YouTube channels and,
 * later, forums, events, courses and books). Each list is one module beside this file with its
 * entries per locale; `index.ts` registers it. How to add or review entries, and the cadence, is
 * in apps/landing/AGENTS.md ("Curated resource lists").
 */
import type { FigureName } from "../../hairline/articleFigures";
import type { Lang } from "../../i18nLocale";
import type { CuratedListRouteId } from "../../routes";
import type { CatalogRouteId } from "../../toolsCatalog";

/** One list per format. The id is also the copy key (`curatedLists.lists.<id>`) and the hub card's destination. */
export type CuratedFormat = "podcast" | "newsletter" | "youtube";

/** A WonderMoney page an entry leads to: a calculator, a standalone guide page or a learn guide. */
export type CuratedRelated =
  | { tool: CatalogRouteId }
  | { page: "pageSavingsGuide" }
  /** A learn guide by its slug in the entry's locale (`src/content/guides/<locale>/<slug>.md`). */
  | { guide: string };

/** ISO date, YYYY-MM-DD. */
export type IsoDate = `${number}-${number}-${number}`;

export interface CuratedEntry {
  /** The show's, newsletter's or channel's name as it publishes it. Never a host's personal name otherwise. */
  name: string;
  /** Its own site (a YouTube channel: its channel page). https, with no query string or fragment. */
  url: string;
  /** BCP 47 tag of the content's language: "pt-PT", "en", "de"… */
  language: string;
  format: CuratedFormat;
  /** Who it is for: one line, written by us, in the page's language. */
  audience: string;
  /** What you get from it: one line, written by us, in the page's language. */
  value: string;
  /** The WonderMoney tool or guide that fits it, when one genuinely does. */
  related?: CuratedRelated;
  /** When we last opened its own site or feed. */
  checked: IsoDate;
  /** The newest episode, issue or video we saw on that date. */
  lastPublished: IsoDate;
  /** Where we saw `lastPublished`: its feed or archive. Not shown. */
  evidence: string;
}

export interface CuratedList {
  id: string;
  routeId: CuratedListRouteId;
  format: CuratedFormat;
  /** The hero's subject figure and the hub card's thumbnail. */
  figure: FigureName;
  /** When the whole list was last reviewed: every entry re-checked against the criteria. */
  reviewed: IsoDate;
  /** 5 to 8 entries per locale, chosen for that market, not translated. */
  entries: Readonly<Record<Lang, readonly CuratedEntry[]>>;
}
