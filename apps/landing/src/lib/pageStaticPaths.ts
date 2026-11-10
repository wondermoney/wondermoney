import { sanityClient } from "sanity:client";

import type { PortableTextBlock, GuideSection } from "./learningContent";
import {
  AD_LANDING_ROUTE_IDS,
  FEATURE_ROUTE_IDS,
  TOP_LEVEL_PAGE_ROUTE_IDS,
  TOOL_ROUTE_IDS,
  getLocalizedSlug,
  type Lang,
  toLang,
} from "./routes";

type TopLevelRouteId = (typeof TOP_LEVEL_PAGE_ROUTE_IDS)[number];
type FeatureRouteId = (typeof FEATURE_ROUTE_IDS)[number];
type ToolRouteId = (typeof TOOL_ROUTE_IDS)[number];
type AdLandingRouteId = (typeof AD_LANDING_ROUTE_IDS)[number];

type GuideEntry = {
  title: string;
  slug: string;
  locale: string;
  category?: string;
  excerpt?: string;
  summary?: string;
  keyTakeaways?: string[];
  body?: PortableTextBlock[];
  sections?: GuideSection[];
  references?: Array<{ title?: string; url?: string; publisher?: string }>;
  lastReviewedAt?: string;
  reviewCadenceDays?: number;
  contentStatus?: string;
  publishedAt?: string;
  seoTitle?: string;
  seoDescription?: string;
  ogImageUrl?: string;
  relatedCalculators?: string[];
  relatedTerms?: {
    slug: string;
    term: string;
    locale: string;
  }[];
  market?: string;
  topicKey?: string;
};

type GlossaryTermEntry = {
  term: string;
  slug: string;
  locale: string;
  plainDefinition?: string;
  technicalDefinition?: string;
  whyItMatters?: string;
  formula?: {
    title?: string;
    expression?: string;
    variables?: Array<{
      label?: string;
      name?: string;
      symbol?: string;
      meaning?: string;
      value?: string | number;
    }>;
    notes?: string;
  };
  miniExample?: string;
  miniTable?: {
    title?: string;
    columns?: string[];
    headers?: string[];
    rows?: unknown[];
  };
  references?: Array<{
    title?: string;
    url?: string;
    publisher?: string;
  }>;
  definition: string;
  explanation?: unknown;
  example?: string;
  category?: string;
  seoTitle?: string;
  seoDescription?: string;
  relatedCalculator?: string;
  relatedTerms?: {
    slug: string;
    term: string;
    locale: string;
  }[];
  relatedGuideSlug?: string;
  relatedGuideTitle?: string;
  market?: string;
  topicKey?: string;
};

type MonthlyContent = {
  title?: string;
  slug?: string;
  locale?: string;
  excerpt?: string;
  seoTitle?: string;
  seoDescription?: string;
  ogImageUrl?: string;
  publishedAt?: string;
  year?: number;
  month?: number;
  methodology?: string;
  dataSources?: ReadonlyArray<{ title?: string; url?: string; publisher?: string }>;
  snapshotTable?: {
    title?: string;
    columns?: ReadonlyArray<string>;
    rows?: ReadonlyArray<ReadonlyArray<string>>;
  };
  trendChartConfig?: {
    title?: string;
    chartType?: string;
    series?: ReadonlyArray<{ label?: string; values?: ReadonlyArray<number> }>;
  };
  changeVsPrevious?: ReadonlyArray<{ metric?: string; delta?: number; unit?: string; note?: string }>;
  whatChanged?: ReadonlyArray<{ title?: string; detail?: string }>;
  whoShouldCare?: ReadonlyArray<string>;
  references?: ReadonlyArray<{ title?: string; url?: string; publisher?: string }>;
  body?: ReadonlyArray<unknown>;
};

const LEGACY_TOP_LEVEL_PAGE_SLUG_BY_ROUTE_ID: Partial<Record<TopLevelRouteId, string>> = {
  pageAbout: "about",
  pageEtfTracker: "etf-tracker",
  pagePortfolioTracker: "portfolio-tracker",
  pageNetWorthTracker: "net-worth-tracker",
  pageYnabAlternative: "ynab-alternative",
  pageFireCalculator: "fire-calculator",
};

const LEGACY_FEATURE_SLUG_BY_ROUTE_ID: Record<FeatureRouteId, string> = {
  featureAccounts: "accounts",
  featureBudgeting: "budgeting",
  featureCategorization: "categorization",
  featureCredits: "loans",
  featureFinancialMarkets: "financial-markets",
  featureGoals: "goals",
  featureNetWorth: "net-worth",
  featurePrivacy: "privacy",
  featurePortfolio: "portfolio",
  featureReports: "reports",
};

const LEGACY_TOOL_SLUG_BY_ROUTE_ID: Record<ToolRouteId, string> = {
  toolCompoundInterest: "compound-interest-calculator",
  toolNetWorth: "net-worth-calculator",
  toolSavingsRate: "savings-rate-calculator",
  toolInvestmentReturn: "investment-return-calculator",
};

function withLegacyAlias<TParam extends string>(
  paramName: TParam,
  slug: string,
  legacySlug: string | undefined,
  routeId: TopLevelRouteId | FeatureRouteId | ToolRouteId,
) {
  const paths: Array<{
    params: Record<TParam, string>;
    props: { routeId: TopLevelRouteId | FeatureRouteId | ToolRouteId; redirectTo?: string };
  }> = [
    {
      params: { [paramName]: slug } as Record<TParam, string>,
      props: { routeId },
    },
  ];

  if (legacySlug && legacySlug !== slug) {
    paths.push({
      params: { [paramName]: legacySlug } as Record<TParam, string>,
      props: { routeId, redirectTo: slug },
    });
  }

  return paths;
}

export function getTopLevelPageStaticPaths(locale: Lang) {
  return TOP_LEVEL_PAGE_ROUTE_IDS.flatMap((routeId) =>
    withLegacyAlias(
      "page",
      getLocalizedSlug(routeId, locale),
      LEGACY_TOP_LEVEL_PAGE_SLUG_BY_ROUTE_ID[routeId],
      routeId,
    ),
  );
}

export function getFeatureStaticPaths(locale: Lang) {
  return FEATURE_ROUTE_IDS.flatMap((routeId) =>
    withLegacyAlias(
      "feature",
      getLocalizedSlug(routeId, locale),
      LEGACY_FEATURE_SLUG_BY_ROUTE_ID[routeId],
      routeId,
    ),
  );
}

export function getToolStaticPaths(locale: Lang) {
  return TOOL_ROUTE_IDS.flatMap((routeId) =>
    withLegacyAlias(
      "tool",
      getLocalizedSlug(routeId, locale),
      LEGACY_TOOL_SLUG_BY_ROUTE_ID[routeId],
      routeId,
    ),
  );
}

export function getAdLandingStaticPaths(locale: Lang) {
  return AD_LANDING_ROUTE_IDS.map((routeId) => ({
    params: { ad: getLocalizedSlug(routeId, locale) },
    props: { routeId },
  }));
}

export async function getLearnGuideStaticPaths(locale: Lang) {
  const siteUrl = "https://wonder.money";

  const guides = await sanityClient.fetch<GuideEntry[]>(
    `*[_type == "guide"] | order(coalesce(publishedAt, _updatedAt) desc, _createdAt desc) {
      title,
      "slug": slug.current,
      locale,
      category,
      excerpt,
      summary,
      keyTakeaways,
      body,
      sections,
      references,
      lastReviewedAt,
      reviewCadenceDays,
      contentStatus,
      publishedAt,
      seoTitle,
      seoDescription,
      "ogImageUrl": ogImage.asset->url,
      relatedCalculators,
      "relatedTerms": relatedTerms[]->{ "slug": slug.current, term, locale },
      market,
      topicKey
    }`,
  );

  const selectedByRoute = new Map<string, GuideEntry>();
  const rankGuideForRouteSelection = (guide: GuideEntry): number =>
    guide.market ? 0 : 1;

  for (const guide of guides) {
    const lang = toLang(guide.locale);
    const routeKey = `${lang}::${guide.slug}`;
    const current = selectedByRoute.get(routeKey);

    if (!current || rankGuideForRouteSelection(guide) > rankGuideForRouteSelection(current)) {
      selectedByRoute.set(routeKey, guide);
    }
  }

  const selectedRoutes = Array.from(selectedByRoute.values()).map((guide) => ({
    guide,
    lang: toLang(guide.locale),
  }));

  const toCanonicalUrl = (route: { guide: GuideEntry; lang: Lang }) => {
    const path = `/${route.lang}/learn/${route.guide.slug}`;
    return `${siteUrl}${path}`;
  };

  return selectedRoutes
    .filter((route) => route.lang === locale)
    .map((route) => {
      const equivalentAlternates = route.guide.topicKey
        ? selectedRoutes
            .filter((candidate) => candidate.guide.topicKey === route.guide.topicKey)
            .map((candidate) => ({ hrefLang: candidate.lang, href: toCanonicalUrl(candidate) }))
        : [];

      const alternateLinks =
        equivalentAlternates.length > 1
          ? equivalentAlternates.filter(
              (link, index, all) => all.findIndex((entry) => entry.href === link.href) === index,
            )
          : [];

      return {
        params: { slug: route.guide.slug },
        props: { guide: route.guide, alternateLinks },
      };
    });
}

export async function getGlossaryTermStaticPaths(locale: Lang) {
  const siteUrl = "https://wonder.money";

  const terms = await sanityClient.fetch<GlossaryTermEntry[]>(
    `*[_type == "glossaryTerm"] | order(_updatedAt desc, _createdAt desc) {
      term,
      "slug": slug.current,
      locale,
      plainDefinition,
      technicalDefinition,
      whyItMatters,
      formula,
      miniExample,
      miniTable,
      references,
      definition,
      explanation,
      example,
      category,
      seoTitle,
      seoDescription,
      relatedCalculator,
      "relatedTerms": relatedTerms[]->{ "slug": slug.current, term, locale },
      "relatedGuideSlug": relatedGuide->slug.current,
      "relatedGuideTitle": relatedGuide->title,
      market,
      topicKey
    }`,
  );

  const selectedByRoute = new Map<string, GlossaryTermEntry>();
  const rankTermForRouteSelection = (term: GlossaryTermEntry): number =>
    term.market ? 0 : 1;

  for (const term of terms) {
    const lang = toLang(term.locale);
    const routeKey = `${lang}::${term.slug}`;
    const current = selectedByRoute.get(routeKey);

    if (!current || rankTermForRouteSelection(term) > rankTermForRouteSelection(current)) {
      selectedByRoute.set(routeKey, term);
    }
  }

  const selectedRoutes = Array.from(selectedByRoute.values()).map((term) => ({
    term,
    locale: toLang(term.locale),
  }));

  const toCanonicalUrl = (route: { term: GlossaryTermEntry; locale: Lang }) => {
    const path = `/${route.locale}/glossary/${route.term.slug}`;
    return `${siteUrl}${path}`;
  };

  return selectedRoutes
    .filter((route) => route.locale === locale)
    .map((route) => {
      const equivalentAlternates = route.term.topicKey
        ? selectedRoutes
            .filter((candidate) => candidate.term.topicKey === route.term.topicKey)
            .map((candidate) => ({ hrefLang: candidate.locale, href: toCanonicalUrl(candidate) }))
        : [];

      const alternateLinks =
        equivalentAlternates.length > 1
          ? equivalentAlternates.filter(
              (link, index, all) => all.findIndex((entry) => entry.href === link.href) === index,
            )
          : [];

      return {
        params: { slug: route.term.slug },
        props: { term: route.term, alternateLinks },
      };
    });
}

export async function getMonthlyStaticPaths(locale: Lang) {
  const monthlyItems = await sanityClient.fetch<MonthlyContent[]>(
    `*[_type == "monthlyContent"]{
      title,
      "slug": slug.current,
      locale,
      excerpt,
      seoTitle,
      seoDescription,
      "ogImageUrl": ogImage.asset->url,
      publishedAt,
      year,
      month,
      methodology,
      dataSources,
      snapshotTable,
      trendChartConfig,
      changeVsPrevious,
      whatChanged,
      whoShouldCare,
      references,
      body
    }`,
  );

  return monthlyItems
    .filter((item) => item.locale && item.slug && toLang(item.locale) === locale)
    .map((item) => ({
      params: { slug: item.slug as string },
      props: { item },
    }));
}

export type {
  TopLevelRouteId,
  FeatureRouteId,
  ToolRouteId,
  AdLandingRouteId,
  GuideEntry,
  GlossaryTermEntry,
  MonthlyContent,
};
