import { describe, expect, it, vi } from "vitest";
import { figureIndexLayout, glossaryTermCards, guideKeepReading, toolsHubGroupCards } from "./figureCards";
import { figureForTool } from "./hairline/articleFigures";
import { toLocalizedPath, toToolsHubPath } from "./routes";
import { buildToolsHub, TOOLS_IN_DISPLAY_ORDER, toolAnalyticsName } from "./toolsCatalog";
import { getTranslations } from "./translations";

vi.mock("sanity:client", () => ({ sanityClient: { fetch: vi.fn() } }));

const siblings = [
  { title: "Old budgeting", slug: "build-monthly-budget", category: "budgeting", publishedAt: "2026-01-01" },
  { title: "Investing", slug: "etf-investing-beginners", category: "investing", publishedAt: "2026-06-01" },
  { title: "New budgeting", slug: "debt-payoff-plan", category: "budgeting", publishedAt: "2026-03-01" },
  { title: "Unmapped", slug: "a-new-guide", category: "tax", publishedAt: "2026-09-01" },
];

describe("guideKeepReading", () => {
  const t = getTranslations("en");

  it("names a calculator by its catalog title and draws its subject", () => {
    const [card] = guideKeepReading({ locale: "en", t, relatedCalculators: ["emergency-fund-calculator"] });
    expect(card).toMatchObject({
      href: toLocalizedPath("toolEmergencyFund", "en"),
      title: t("tools.emergencyFund.title"),
      figure: "jar",
      kind: "Calculator",
    });
  });

  it("sends calculators the catalog does not know to the tools hub, once", () => {
    const cards = guideKeepReading({ locale: "pt", t: getTranslations("pt"), relatedCalculators: ["budget-planner", "nope"] });
    expect(cards.filter((card) => card.href === toToolsHubPath("pt"))).toHaveLength(1);
  });

  it("fills to three with guides of the same category first, then the newest", () => {
    const cards = guideKeepReading({
      locale: "en",
      t,
      relatedCalculators: ["emergency-fund-calculator", "compound-interest-calculator", "inflation-calculator"],
      category: "budgeting",
      siblings,
    });
    expect(cards).toHaveLength(3);
    expect(cards.map((card) => card.kind)).toEqual(["Calculator", "Calculator", "Guide"]);
    expect(cards[2]).toMatchObject({ href: "/en/learn/debt-payoff-plan", title: "New budgeting", figure: "snowball" });
  });

  it("shows guides only, and the hub figure for a guide nobody mapped", () => {
    const cards = guideKeepReading({ locale: "en", t, category: "tax", siblings });
    expect(cards.map((card) => card.href)).toEqual([
      "/en/learn/a-new-guide",
      "/en/learn/etf-investing-beginners",
      "/en/learn/debt-payoff-plan",
    ]);
    expect(cards[0].figure).toBe("booklets");
  });

  it("is empty with nothing to link", () => {
    expect(guideKeepReading({ locale: "en", t })).toEqual([]);
  });
});

describe("glossaryTermCards", () => {
  const t = getTranslations("pt");

  it("leads with the named calculator, then the guide, then the paired calculators", () => {
    const cards = glossaryTermCards({
      locale: "pt",
      t,
      relatedCalculator: "loan-calculator",
      relatedGuide: { slug: "plano-para-pagar-dividas", title: "Plano para pagar dívidas" },
    });
    expect(cards[0]).toMatchObject({ href: toLocalizedPath("toolMortgage", "pt"), title: t("tools.mortgage.title"), kind: "Calculadora" });
    expect(cards[1]).toMatchObject({ href: "/pt/learn/plano-para-pagar-dividas", figure: "snowball", kind: "Guia" });
    expect(cards.length).toBeGreaterThan(2);
    expect(new Set(cards.map((card) => card.href)).size).toBe(cards.length);
  });

  it("names a calculator the catalog does not know after the tools hub", () => {
    expect(glossaryTermCards({ locale: "pt", t, relatedCalculator: "nope" })).toEqual([
      expect.objectContaining({ href: toToolsHubPath("pt"), title: t("resources.links.tools.title") }),
    ]);
  });

  it("is empty with nothing to link", () => {
    expect(glossaryTermCards({ locale: "en", t: getTranslations("en") })).toEqual([]);
  });
});

describe("toolsHubGroupCards", () => {
  const t = getTranslations("en");
  const groups = buildToolsHub("en");

  it("gives a group of one tool its figure: net worth draws the scale", () => {
    const trackWealth = groups.find((group) => group.id === "trackWealth")!;
    expect(figureIndexLayout(trackWealth.tools.length).lead).toBe(true);
    expect(toolsHubGroupCards(trackWealth, t)[0].figure).toBe("scale");
  });

  it("makes one card per tool, in catalog order, so no tool drops off the hub", () => {
    const hrefs = groups.flatMap((group) => toolsHubGroupCards(group, t).map((card) => card.href));
    expect(hrefs).toEqual(TOOLS_IN_DISPLAY_ORDER.map((tool) => toLocalizedPath(tool.routeId, "en")));
  });

  it("names each tool and carries the hub's click tracking", () => {
    const [group] = groups;
    const [tool] = group.tools;
    expect(toolsHubGroupCards(group, t)[0]).toEqual({
      href: tool.href,
      title: t(`tools.${tool.key}.title`),
      description: t(`tools.${tool.key}.description`),
      figure: figureForTool(tool.routeId),
      kind: "Calculator",
      data: {
        "data-tools-hub-link": "tool",
        "data-tool": toolAnalyticsName(tool.key),
        "data-group": group.id,
        "data-position": String(tool.position),
      },
    });
  });
});

describe("figureIndexLayout", () => {
  it("leads with a figure card spanning the rows beside it, two or three to a row", () => {
    expect(figureIndexLayout(15)).toEqual({ lead: true, spanTwo: 7, spanThree: 5 });
    expect(figureIndexLayout(11)).toEqual({ lead: true, spanTwo: 5, spanThree: 4 });
    expect(figureIndexLayout(2)).toEqual({ lead: true, spanTwo: 1, spanThree: 1 });
  });

  it("draws a lone card as the lead figure card too, not as a row", () => {
    expect(figureIndexLayout(1)).toEqual({ lead: true, spanTwo: 1, spanThree: 1 });
  });

  it("has nothing to lead with no cards", () => {
    expect(figureIndexLayout(0)).toEqual({ lead: false, spanTwo: 0, spanThree: 0 });
  });
});
