/**
 * The learn content routes (guides, glossary terms, monthly items), read from the content
 * collections in `src/content/` (`content.config.ts`). The other routes' static paths are in
 * `pageStaticPaths.ts`, which stays free of `astro:content` so plain unit tests can import it.
 */
import { getCollection } from "astro:content";
import {
  buildGlossaryTerms,
  buildGuides,
  buildMonthlyItems,
  topicAlternateLinks,
  type GlossaryTermEntry,
  type GuideEntry,
  type MonthlyContent,
} from "./contentEntries";
import type { Lang } from "./routes";

/** Every guide in every locale, newest first. */
export async function getGuides(): Promise<GuideEntry[]> {
  const [guides, terms] = await Promise.all([getCollection("guides"), getCollection("glossary")]);
  return buildGuides(guides, terms);
}

/** Every glossary term in every locale, alphabetical. */
export async function getGlossaryTerms(): Promise<GlossaryTermEntry[]> {
  const [terms, guides] = await Promise.all([getCollection("glossary"), getCollection("guides")]);
  return buildGlossaryTerms(terms, guides);
}

/** Every monthly item in every locale, latest month first. */
export async function getMonthlyItems(): Promise<MonthlyContent[]> {
  return buildMonthlyItems(await getCollection("monthly"));
}

export async function getLearnGuideStaticPaths(locale: Lang) {
  const guides = await getGuides();
  return guides
    .filter((guide) => guide.locale === locale)
    .map((guide) => ({
      params: { slug: guide.slug },
      props: { guide, alternateLinks: topicAlternateLinks(guide, guides, (lang, slug) => `/${lang}/learn/${slug}`) },
    }));
}

export async function getGlossaryTermStaticPaths(locale: Lang) {
  const terms = await getGlossaryTerms();
  return terms
    .filter((term) => term.locale === locale)
    .map((term) => ({
      params: { slug: term.slug },
      props: { term, alternateLinks: topicAlternateLinks(term, terms, (lang, slug) => `/${lang}/glossary/${slug}`) },
    }));
}

export async function getMonthlyStaticPaths(locale: Lang) {
  const items = await getMonthlyItems();
  return items
    .filter((item) => item.locale === locale)
    .map((item) => ({ params: { slug: item.slug }, props: { item } }));
}

export type { GlossaryTermEntry, GuideEntry, MonthlyContent };
