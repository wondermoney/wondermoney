import { describe, expect, it, vi } from "vitest";
import { guideKeepReading } from "./figureCards";
import { toLocalizedPath, toToolsHubPath } from "./routes";
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
