/**
 * The learn content (`src/content/`) as the pages read it: each collection entry with its
 * locale and slug taken from its path, its references to other documents resolved within the
 * same locale, and the plain text of its Markdown body. Pure functions over the entries, so
 * they are tested without Astro; `contentCollections.ts` feeds them `getCollection()`.
 */
import type { GlossaryTermData, GuideData, MonthlyData } from "@/content/schemas";
import { htmlToPlain } from "./articleOutline";
import { resolveCalculatorRouteIdFromLegacy, SUPPORTED_LANGS, type Lang } from "./routes";

/** What these functions need of an Astro collection entry. */
export type ContentEntry<TData> = {
  id: string;
  data: TData;
  rendered?: { html: string };
};

type RelatedTerm = { slug: string; term: string; locale: Lang };

type Located = {
  /** The entry id, `<locale>/<slug>`: what `getEntry()` takes to render the body. */
  id: string;
  slug: string;
  locale: Lang;
  /** The Markdown body as plain text, one line per block; empty when there is no body. */
  bodyText: string;
};

export type GuideEntry = Omit<GuideData, "publishedAt" | "lastReviewedAt" | "relatedTerms" | "ogImage"> &
  Located & {
    /** ISO 8601, as the `<time datetime>` and the structured data print it. */
    publishedAt: string;
    lastReviewedAt?: string;
    ogImageUrl?: string;
    relatedTerms: RelatedTerm[];
  };

export type GlossaryTermEntry = Omit<GlossaryTermData, "relatedTerms" | "relatedGuide"> &
  Located & {
    relatedTerms: RelatedTerm[];
    relatedGuideSlug?: string;
    relatedGuideTitle?: string;
  };

export type MonthlyContent = Omit<MonthlyData, "publishedAt" | "ogImage"> &
  Located & {
    publishedAt?: string;
    ogImageUrl?: string;
  };

/** The locale and slug of an entry id, which must be `<locale>/<slug>`. */
export function entryPath(id: string): { locale: Lang; slug: string } {
  const [locale, slug, ...rest] = id.split("/");
  if (rest.length > 0 || !slug || !(SUPPORTED_LANGS as readonly string[]).includes(locale)) {
    throw new Error(`Content entry "${id}" must be at <locale>/<slug>.md, with one of ${SUPPORTED_LANGS.join(", ")}`);
  }
  return { locale: locale as Lang, slug };
}

function located(entry: ContentEntry<unknown>): Located {
  return { id: entry.id, ...entryPath(entry.id), bodyText: htmlToPlain(entry.rendered?.html ?? "") };
}

function indexById<TEntry extends { id: string }>(entries: ReadonlyArray<TEntry>): Map<string, TEntry> {
  return new Map(entries.map((entry) => [entry.id, entry]));
}

function resolve<TData>(
  index: Map<string, ContentEntry<TData>>,
  from: string,
  collection: string,
  locale: Lang,
  slug: string,
): ContentEntry<TData> {
  const target = index.get(`${locale}/${slug}`);
  if (!target) throw new Error(`${from} refers to ${collection} "${slug}", which has no file at ${collection}/${locale}/${slug}.md`);
  return target;
}

/**
 * Checks that a related calculator names a tool or calculator page (`resolveCalculatorRouteIdFromLegacy`):
 * the cards would otherwise lead to the tools hub without saying so.
 */
function checkCalculator(from: string, locale: Lang, value: string): string {
  if (!resolveCalculatorRouteIdFromLegacy(value, locale)) {
    throw new Error(`${from} names the calculator "${value}", which is no tool: use a key from LEGACY_TOOL_ROUTE_ID_BY_KEY in routes.ts, the tool's ${locale} slug or its route id`);
  }
  return value;
}

/** Folds accents away, so "Património" files under P next to "Patrimonio" and the order stays the code-point one. */
const sortKey = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "");
const byText = (a: string, b: string) => {
  const left = sortKey(a);
  const right = sortKey(b);
  return left < right ? -1 : left > right ? 1 : a.localeCompare(b);
};

/** Every guide, newest first. */
export function buildGuides(
  guides: ReadonlyArray<ContentEntry<GuideData>>,
  terms: ReadonlyArray<ContentEntry<GlossaryTermData>>,
): GuideEntry[] {
  const termIndex = indexById(terms);
  return guides
    .map((entry) => {
      const { publishedAt, lastReviewedAt, relatedTerms, ogImage, ...data } = entry.data;
      const place = located(entry);
      return {
        ...data,
        ...place,
        relatedCalculators: data.relatedCalculators.map((value) => checkCalculator(`guides/${entry.id}`, place.locale, value)),
        publishedAt: publishedAt.toISOString(),
        lastReviewedAt: lastReviewedAt?.toISOString(),
        ogImageUrl: ogImage,
        relatedTerms: relatedTerms.map((slug) => ({
          slug,
          term: resolve(termIndex, `guides/${entry.id}`, "glossary", place.locale, slug).data.term,
          locale: place.locale,
        })),
      };
    })
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || a.id.localeCompare(b.id));
}

/** Every glossary term, in alphabetical order of the term. */
export function buildGlossaryTerms(
  terms: ReadonlyArray<ContentEntry<GlossaryTermData>>,
  guides: ReadonlyArray<ContentEntry<GuideData>>,
): GlossaryTermEntry[] {
  const termIndex = indexById(terms);
  const guideIndex = indexById(guides);
  return terms
    .map((entry) => {
      const { relatedTerms, relatedGuide, ...data } = entry.data;
      const place = located(entry);
      const from = `glossary/${entry.id}`;
      const guide = relatedGuide ? resolve(guideIndex, from, "guides", place.locale, relatedGuide) : undefined;
      return {
        ...data,
        ...place,
        relatedCalculator: data.relatedCalculator && checkCalculator(from, place.locale, data.relatedCalculator),
        relatedTerms: relatedTerms.map((slug) => ({
          slug,
          term: resolve(termIndex, from, "glossary", place.locale, slug).data.term,
          locale: place.locale,
        })),
        relatedGuideSlug: relatedGuide,
        relatedGuideTitle: guide?.data.title,
      };
    })
    .sort((a, b) => byText(a.term, b.term) || a.id.localeCompare(b.id));
}

/** Every monthly item, latest month first. */
export function buildMonthlyItems(items: ReadonlyArray<ContentEntry<MonthlyData>>): MonthlyContent[] {
  return items
    .map((entry) => {
      const { publishedAt, ogImage, ...data } = entry.data;
      return { ...data, ...located(entry), publishedAt: publishedAt?.toISOString(), ogImageUrl: ogImage };
    })
    .sort((a, b) => b.year - a.year || b.month - a.month || a.id.localeCompare(b.id));
}

/**
 * The hreflang alternates of a document: its translations, the documents of every locale that
 * share its `topicKey`. None without a topic key or without a translation.
 */
export function topicAlternateLinks(
  item: Pick<Located, "locale" | "slug"> & { topicKey?: string },
  all: ReadonlyArray<Pick<Located, "locale" | "slug"> & { topicKey?: string }>,
  pathFor: (locale: Lang, slug: string) => string,
): Array<{ hrefLang: Lang; href: string }> {
  if (!item.topicKey) return [];
  const links = all
    .filter((candidate) => candidate.topicKey === item.topicKey)
    .map((candidate) => ({ hrefLang: candidate.locale, href: `https://wonder.money${pathFor(candidate.locale, candidate.slug)}` }))
    .filter((link, index, list) => list.findIndex((other) => other.href === link.href) === index);
  return links.length > 1 ? links : [];
}
