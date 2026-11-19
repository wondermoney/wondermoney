import { figureForGuide, figureForTool, PAGE_FIGURES, type FigureName } from "./hairline/articleFigures";
import { getRelatedContentTools } from "./relatedContentTools";
import {
  resolveCalculatorRouteIdFromLegacy,
  toLocalizedPath,
  toToolsHubPath,
  TOOL_ROUTE_IDS,
  type Lang,
  type RouteId,
  type ToolRouteId,
} from "./routes";
import { getToolCatalogEntry } from "./toolsCatalog";
import type { Translate } from "./translations";

/** A link card that leads with its destination's figure (FigureCards.astro). */
export interface FigureCard {
  href: string;
  title: string;
  figure: FigureName;
  /** A short line above the title: Guide, Calculator… */
  kind?: string;
  description?: string;
  /** Extra attributes for the link, e.g. a tracking data attribute. */
  data?: Record<`data-${string}`, string>;
}

export type SiblingGuide = { title: string; slug: string; category?: string; publishedAt?: string };

const KEEP_READING = 3;
const MAX_TOOLS = 2;

const isCatalogRoute = (routeId: RouteId | undefined): routeId is ToolRouteId | "pageFireCalculator" =>
  routeId === "pageFireCalculator" || (TOOL_ROUTE_IDS as readonly string[]).includes(routeId ?? "");

/**
 * "Keep reading" under a learn guide: its calculators first (at most two, by
 * their catalog names), then other guides in the same locale, the same
 * category first, to three cards.
 */
export function guideKeepReading(input: {
  locale: Lang;
  t: Translate;
  relatedCalculators?: readonly string[];
  category?: string;
  siblings?: readonly SiblingGuide[];
}): FigureCard[] {
  const { locale, t, relatedCalculators = [], category, siblings = [] } = input;
  const calculator = t("global.relatedContent.calculator");
  const tools: FigureCard[] = [];
  const seen = new Set<string>();
  const addTool = (card: FigureCard) => {
    if (seen.has(card.href)) return;
    seen.add(card.href);
    tools.push(card);
  };

  for (const legacy of relatedCalculators) {
    const routeId = resolveCalculatorRouteIdFromLegacy(legacy, locale);
    if (isCatalogRoute(routeId)) {
      const { key } = getToolCatalogEntry(routeId);
      addTool({ href: toLocalizedPath(routeId, locale), title: t(`tools.${key}.title`), figure: figureForTool(routeId), kind: calculator });
    } else {
      // A name the catalog does not know: the tools hub, as one card however many there are.
      addTool({ href: toToolsHubPath(locale), title: t("resources.links.tools.title"), figure: "calculator", kind: calculator });
    }
  }
  for (const tool of getRelatedContentTools(tools, locale, t)) {
    addTool({ href: tool.href, title: tool.title, figure: "calculator", kind: calculator });
  }

  const guide = t("global.relatedContent.guide");
  const ranked = [...siblings].sort(
    (a, b) =>
      Number(b.category === category) - Number(a.category === category) ||
      (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""),
  );
  const guides = ranked.map((sibling) => ({
    href: `/${locale}/learn/${sibling.slug}`,
    title: sibling.title,
    figure: figureForGuide(sibling.slug) ?? PAGE_FIGURES.learnHub,
    kind: guide,
  }));

  const picked = tools.slice(0, guides.length > 0 ? MAX_TOOLS : KEEP_READING);
  return [...picked, ...guides].slice(0, KEEP_READING);
}
