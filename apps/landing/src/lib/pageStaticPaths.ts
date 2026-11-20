/**
 * Static paths of the page, feature, tool and ad routes. The learn content routes (guides,
 * glossary, monthly) are in `contentCollections.ts`.
 */
import { CURATED_LIST_IDS, getCuratedList } from "./resources/curatedLists";
import {
  AD_LANDING_ROUTE_IDS,
  FEATURE_ROUTE_IDS,
  TOP_LEVEL_PAGE_ROUTE_IDS,
  TOOL_ROUTE_IDS,
  getLocalizedSlug,
  type Lang,
} from "./routes";

type TopLevelRouteId = (typeof TOP_LEVEL_PAGE_ROUTE_IDS)[number];
type FeatureRouteId = (typeof FEATURE_ROUTE_IDS)[number];
type ToolRouteId = (typeof TOOL_ROUTE_IDS)[number];
type AdLandingRouteId = (typeof AD_LANDING_ROUTE_IDS)[number];

export function getTopLevelPageStaticPaths(locale: Lang) {
  return TOP_LEVEL_PAGE_ROUTE_IDS.map((routeId) => ({
    params: { page: getLocalizedSlug(routeId, locale) },
    props: { routeId },
  }));
}

export function getFeatureStaticPaths(locale: Lang) {
  return FEATURE_ROUTE_IDS.map((routeId) => ({
    params: { feature: getLocalizedSlug(routeId, locale) },
    props: { routeId },
  }));
}

export function getToolStaticPaths(locale: Lang) {
  return TOOL_ROUTE_IDS.map((routeId) => ({
    params: { tool: getLocalizedSlug(routeId, locale) },
    props: { routeId },
  }));
}

export function getAdLandingStaticPaths(locale: Lang) {
  return AD_LANDING_ROUTE_IDS.map((routeId) => ({
    params: { ad: getLocalizedSlug(routeId, locale) },
    props: { routeId },
  }));
}

/** The curated lists under the resources hub: `src/pages/{lang}/{resources}/[list].astro`. */
export function getCuratedListStaticPaths(locale: Lang) {
  return CURATED_LIST_IDS.map((listId) => ({
    params: { list: getLocalizedSlug(getCuratedList(listId).routeId, locale) },
    props: { listId },
  }));
}

export type {
  TopLevelRouteId,
  FeatureRouteId,
  ToolRouteId,
  AdLandingRouteId,
};
