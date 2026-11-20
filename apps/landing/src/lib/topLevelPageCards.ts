import type { FigureCard } from "./figureCards";
import { figureForTool, PAGE_FIGURES } from "./hairline/articleFigures";
import { toLocalizedPath, type Lang } from "./routes";
import { getToolCatalogEntry } from "./toolsCatalog";
import type { Translate } from "./translations";

/** The standalone pages the FIRE calculator and the net worth guide link to in their related cards. */
export type TopLevelCardRouteId =
  | "pageFireCalculator"
  | "pageHowToCalculateNetWorth"
  | "pageNetWorthTracker"
  | "pagePortfolioTracker";

/** A figure card (FigureCards.astro) for a standalone page, labelled by what it is. */
export function topLevelPageCard(routeId: TopLevelCardRouteId, locale: Lang, t: Translate): FigureCard {
  const href = toLocalizedPath(routeId, locale);
  switch (routeId) {
    case "pageFireCalculator": {
      const { key } = getToolCatalogEntry(routeId);
      return {
        href,
        title: t(`tools.${key}.title`),
        description: t(`tools.${key}.description`),
        figure: figureForTool(routeId),
        kind: t("global.relatedContent.calculator"),
      };
    }
    case "pageHowToCalculateNetWorth":
      return {
        href,
        title: t("lp.howToCalculateNetWorth.heroTitle"),
        description: t("lp.howToCalculateNetWorth.metaDescription"),
        figure: PAGE_FIGURES.pageHowToCalculateNetWorth,
        kind: t("global.relatedContent.guide"),
      };
    case "pageNetWorthTracker":
    case "pagePortfolioTracker": {
      const prefix = routeId === "pageNetWorthTracker" ? "lp.netWorthTracker" : "lp.portfolioTracker";
      return {
        href,
        title: t(`${prefix}.eyebrow`),
        description: t(`${prefix}.metaDescription`),
        figure: PAGE_FIGURES[routeId],
        kind: t("global.relatedContent.feature"),
      };
    }
  }
}
