/**
 * The shape of a curated list of outside resources: podcasts, newsletters, YouTube channels,
 * forums and communities, books, courses and financial education events. Each list is one module
 * beside this file with its entries per locale; `index.ts` registers it. How to add or review
 * entries, and the cadence, is in apps/landing/AGENTS.md ("Curated resource lists").
 */
import type { FigureName } from "../../hairline/articleFigures";
import type { Lang } from "../../i18nLocale";
import type { CuratedListRouteId } from "../../routes";
import type { CatalogRouteId } from "../../toolsCatalog";

/** What an entry is. Its label is `curatedLists.common.formats.<format>`. */
export type CuratedFormat =
  | "podcast"
  | "newsletter"
  | "youtube"
  | "forum"
  | "book"
  | "course"
  /** A dated, one-off event. */
  | "event"
  /** A recurring programme: a yearly financial literacy day, week or month. */
  | "programme";

/** A WonderMoney page an entry leads to: a calculator, a standalone guide page or a learn guide. */
export type CuratedRelated =
  | { tool: CatalogRouteId }
  | { page: "pageSavingsGuide" }
  /** A learn guide by its slug in the entry's locale (`src/content/guides/<locale>/<slug>.md`). */
  | { guide: string };

/** ISO date, YYYY-MM-DD. */
export type IsoDate = `${number}-${number}-${number}`;

/** The rules a list's entries meet, in the order its page lists them (`curatedLists.common.criteria.<key>`). */
export type CuratedCriterion =
  | "active"
  | "independent"
  | "noHype"
  | "free"
  | "market"
  | "activeCommunity"
  | "openModerated"
  | "independentCommunity"
  | "noSignals"
  | "inPrint"
  | "publicProvider"
  | "freeOrPriced"
  | "noFunnel"
  | "open"
  | "officialOrganiser"
  | "freeToAttend"
  | "upcoming";

interface CuratedEntryBase {
  /** As it publishes it: a show's, community's, course's or event's name, a book's title in this edition. */
  name: string;
  /** Its own site (a YouTube channel: its channel page; a book: its publisher's page for this edition). https, with no query string or fragment. */
  url: string;
  /** BCP 47 tag of the content's language: "pt-PT", "en", "de"… */
  language: string;
  /** Who it is for: one line, written by us, in the page's language. */
  audience: string;
  /** What you get from it: one line, written by us, in the page's language. */
  value: string;
  /** The WonderMoney tool or guide that fits it, when one genuinely does. */
  related?: CuratedRelated;
  /** When we last opened its own site, feed or page. */
  checked: IsoDate;
  /** Where we saw what we checked (the newest item, the edition, the price, the dates). Not shown. */
  evidence: string;
}

/** A podcast, newsletter or YouTube channel. */
export interface CuratedMediaEntry extends CuratedEntryBase {
  format: "podcast" | "newsletter" | "youtube";
  /** The newest episode, issue or video we saw on `checked`. */
  lastPublished: IsoDate;
}

export type CuratedPlatform = "subreddit" | "forum" | "discord" | "telegram";

/** A public community: publicly joinable and moderated. */
export interface CuratedForumEntry extends CuratedEntryBase {
  format: "forum";
  platform: CuratedPlatform;
  /** Its rules and moderation as we saw them: one line, written by us. */
  moderation: string;
  /** The newest post we saw on `checked`: within a month of it. */
  lastPublished: IsoDate;
}

/** A book in an edition in the page's language, linked to its publisher's page. */
export interface CuratedBookEntry extends CuratedEntryBase {
  format: "book";
  /** As on the cover. Authors are public figures; still, drop a book whose author trips the leak check. */
  author: string;
  publisher: string;
  /** This edition's publication year. */
  year: number;
  /** The original title, when this edition is a translation. */
  originalTitle?: string;
}

export type CourseLevel = "beginner" | "intermediate" | "advanced" | "all";
export type CourseDelivery = "selfPaced" | "liveOnline" | "inPerson" | "blended";
/** "free", or the price we saw on the course's own page. */
export type CoursePrice = "free" | { amount: number; currency: "EUR" | "GBP" | "CHF" };

/** A course open to follow or enrol in on `checked`. */
export interface CuratedCourseEntry extends CuratedEntryBase {
  format: "course";
  /** The organisation that runs it. */
  provider: string;
  level: CourseLevel;
  delivery: CourseDelivery;
  price: CoursePrice;
  /** How long it takes, as a short phrase in the page's language, when the provider says. */
  duration?: string;
}

/** A recurring programme run by an official or public-interest organiser. */
export interface CuratedProgrammeEntry extends CuratedEntryBase {
  format: "programme";
  organiser: string;
  /** When it runs, one line in the page's language ("Every year in October"). */
  when: string;
  /**
   * The start of the latest edition held: within 13 months of `checked`, unless `next` is set.
   * Left out only when the organiser keeps no past editions online and `next` is set.
   */
  lastHeld?: IsoDate;
  /** The next edition, once its organiser has announced the dates. */
  next?: { starts: IsoDate; ends: IsoDate };
}

/** A dated event run by an official or public-interest organiser. It shows until it ends. */
export interface CuratedEventEntry extends CuratedEntryBase {
  format: "event";
  organiser: string;
  starts: IsoDate;
  /** The last day; the same as `starts` for a one-day event. */
  ends: IsoDate;
  /** "Online" or the town, in the page's language. */
  where: string;
}

export type CuratedEntry =
  | CuratedMediaEntry
  | CuratedForumEntry
  | CuratedBookEntry
  | CuratedCourseEntry
  | CuratedProgrammeEntry
  | CuratedEventEntry;

export interface CuratedList<Entry extends CuratedEntry = CuratedEntry> {
  id: string;
  routeId: CuratedListRouteId;
  /** The formats its entries may have. */
  formats: readonly Entry["format"][];
  /** The rules on its page, in order. */
  criteria: readonly CuratedCriterion[];
  /**
   * How often the whole list is re-checked: "halfYearly" for lists that change slowly, "monthly"
   * for events. The page warns once a list is past it (`CURATED_REVIEW_DAYS`).
   */
  review: "halfYearly" | "monthly";
  /** The hero's subject figure and the hub card's thumbnail. */
  figure: FigureName;
  /** When the whole list was last reviewed: every entry re-checked against the criteria. */
  reviewed: IsoDate;
  /** Entries per locale, chosen for that market, not translated. Counts: `curatedLists.test.ts`. */
  entries: Readonly<Record<Lang, readonly Entry[]>>;
}
