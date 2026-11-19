import { describe, expect, it, vi } from "vitest";
import { getGuidedDestination, scoreLiteracyQuiz } from "./guidedStart";
import { getToolStaticPaths, getTopLevelPageStaticPaths } from "./pageStaticPaths";
import { SUPPORTED_LANGS, toLocalizedPath } from "./routes";
import { isSitemapPage } from "./sitemap";

// Only content routes use the Sanity client imported by pageStaticPaths.
vi.mock("sanity:client", () => ({ sanityClient: { fetch: vi.fn() } }));

describe("guided start routing", () => {
  const scenarios = [
    ["budget", "review", "toolNetWorth"],
    ["budget", "plan", "toolHouseholdBudget"],
    ["savings", "review", "toolSavingsRate"],
    ["savings", "plan", "toolSavingsGoal"],
    ["investing", "review", "toolInvestmentReturn"],
    ["investing", "plan", "toolCompoundInterest"],
  ] as const;

  it.each(scenarios)("maps %s and %s to the expected tool in every locale", (goal, task, expected) => {
    const destination = getGuidedDestination(goal, task);
    expect(destination).toBe(expected);
    for (const locale of SUPPORTED_LANGS) {
      const toolPaths = getToolStaticPaths(locale).map(({ params }) => `/${locale}/tools/${params.tool}`);
      expect(toolPaths).toContain(toLocalizedPath(destination, locale));
    }
  });

  it.each(SUPPORTED_LANGS)("prerenders a canonical, sitemap-eligible page for %s", (locale) => {
    const path = toLocalizedPath("pageGuidedStart", locale);
    const pagePaths = getTopLevelPageStaticPaths(locale).map(({ params }) => `/${locale}/${params.page}`);
    expect(pagePaths).toContain(path);
    expect(isSitemapPage(`https://wonder.money${path}`)).toBe(true);
  });
});

describe("literacy quiz scoring", () => {
  it("requires an answer to every question", () => {
    expect(scoreLiteracyQuiz({ budget: 0, fees: 2, inflation: 1 })).toBeUndefined();
  });

  it("counts correct answers, including the first choice", () => {
    expect(scoreLiteracyQuiz({ budget: 0, fees: 2, inflation: 1, diversification: 0 })).toBe(4);
    expect(scoreLiteracyQuiz({ budget: 0, fees: 0, inflation: 1, diversification: 1 })).toBe(2);
    expect(scoreLiteracyQuiz({ budget: 1, fees: 0, inflation: 2, diversification: 2 })).toBe(0);
  });
});
