import { describe, expect, it } from "vitest";
import { FIGURE_NAMES } from "./hairline/articleFigures";
import { SUPPORTED_LANGS, toLocalizedPath } from "./routes";
import { topLevelPageCard, type TopLevelCardRouteId } from "./topLevelPageCards";
import { getTranslations } from "./translations";

const ROUTE_IDS: TopLevelCardRouteId[] = [
  "pageFireCalculator",
  "pageHowToCalculateNetWorth",
  "pageNetWorthTracker",
  "pagePortfolioTracker",
];

describe("standalone page cards", () => {
  it.each(SUPPORTED_LANGS)("links each page in %s with its copy, a label and a figure", (locale) => {
    const t = getTranslations(locale);
    for (const routeId of ROUTE_IDS) {
      const card = topLevelPageCard(routeId, locale, t);
      expect(card.href).toBe(toLocalizedPath(routeId, locale));
      expect(card.title.trim()).not.toBe("");
      expect(card.description?.trim()).not.toBe("");
      expect(card.kind?.trim()).not.toBe("");
      expect(FIGURE_NAMES).toContain(card.figure);
    }
  });

  it("shows the FIRE calculator with its deck chair and the net worth guide with its scale", () => {
    const t = getTranslations("en");
    expect(topLevelPageCard("pageFireCalculator", "en", t)).toMatchObject({ figure: "deckchair", kind: "Calculator" });
    expect(topLevelPageCard("pageHowToCalculateNetWorth", "en", t)).toMatchObject({ figure: "scale", kind: "Guide" });
    expect(topLevelPageCard("pageNetWorthTracker", "en", t).kind).toBe("Feature");
  });
});
