import { describe, expect, it } from "vitest";
import { getRelatedContentTools } from "../relatedContentTools";
import { buildAlternateLinks, SUPPORTED_LANGS, toLocalizedPath } from "../routes";
import { getTranslations } from "../translations";
import { computeInflation, INFLATION_EXAMPLE, INFLATION_MAX_AMOUNT } from "./inflation";
import { CPI_SOURCE, CPI_YEARS, PORTUGAL_CPI } from "./portugalCpi";

describe("INE annual CPI snapshot", () => {
  it("contains positive, contiguous, complete annual observations for the published range", () => {
    expect(CPI_YEARS).toEqual(Array.from({ length: 78 }, (_, index) => 1948 + index));
    expect(CPI_YEARS.every((year) => Number.isFinite(PORTUGAL_CPI[year]) && PORTUGAL_CPI[year] > 0)).toBe(true);
    expect(PORTUGAL_CPI[1948]).toBe(0.817);
    expect(PORTUGAL_CPI[2020]).toBe(83.764);
    expect(PORTUGAL_CPI[2024]).toBe(97.717);
    expect(PORTUGAL_CPI[CPI_SOURCE.baseYear]).toBe(100);
  });
});

describe("purchasing power", () => {
  it("converts a budget and deflates a nominal investment balance to starting-year prices", () => {
    const result = computeInflation(INFLATION_EXAMPLE);
    expect(result?.equivalent).toBeCloseTo(1193.83, 2);
    expect(result?.budgetChange).toBeCloseTo(193.83, 2);
    expect(result?.priceChange).toBeCloseTo(19.3830, 4);
    expect(result?.realValue).toBeCloseTo(921.404, 3);
    expect(result?.realChange).toBeCloseTo(-78.596, 3);
  });

  it("supports comparisons in either direction and distinguishes same-year and zero balances", () => {
    expect(computeInflation({ from: 2025, to: 2020, amount: 100, finalValue: null })).toEqual({
      equivalent: 83.764,
      budgetChange: expect.closeTo(-16.236),
      priceChange: expect.closeTo(-16.236),
      realValue: null,
      realChange: null,
    });
    expect(computeInflation({ from: 2025, to: 2025, amount: 0, finalValue: 0 })).toEqual({
      equivalent: 0,
      budgetChange: 0,
      priceChange: 0,
      realValue: 0,
      realChange: 0,
    });
  });

  it("reflects deflation between years in the official series", () => {
    expect(computeInflation({ from: 2019, to: 2020, amount: 1000, finalValue: null })?.budgetChange).toBeLessThan(0);
  });

  it("rejects empty or extreme required inputs and years outside the snapshot", () => {
    for (const overrides of [
      { amount: NaN },
      { amount: -1 },
      { amount: Infinity },
      { amount: INFLATION_MAX_AMOUNT + 1 },
      { finalValue: NaN },
      { finalValue: INFLATION_MAX_AMOUNT + 1 },
      { finalValue: -1 },
      { from: 1947 },
      { to: 2026 },
    ]) {
      expect(computeInflation({ ...INFLATION_EXAMPLE, ...overrides })).toBeNull();
    }

    expect(computeInflation({
      from: 1948, to: 2025, amount: INFLATION_MAX_AMOUNT, finalValue: INFLATION_MAX_AMOUNT,
    })?.equivalent).toBeCloseTo(INFLATION_MAX_AMOUNT / 0.00817, 2);
  });
});

describe("localized inflation calculator", () => {
  it("has unique metadata and a localized alternate for every language", () => {
    const titles = new Set<string>();
    const descriptions = new Set<string>();

    for (const locale of SUPPORTED_LANGS) {
      const t = getTranslations(locale);
      titles.add(t("tools.inflation.pageTitle"));
      descriptions.add(t("tools.inflation.pageDescription"));
      expect(buildAlternateLinks("toolInflation")).toContainEqual(
        expect.objectContaining({ href: `https://wonder.money${toLocalizedPath("toolInflation", locale)}` }),
      );
    }
    expect(titles.size).toBe(SUPPORTED_LANGS.length);
    expect(descriptions.size).toBe(SUPPORTED_LANGS.length);
  });

  it.each(SUPPORTED_LANGS)("links from relevant learning content in %s without duplicating CMS links", (locale) => {
    const t = getTranslations(locale);
    const href = toLocalizedPath("toolInflation", locale);
    const sources = [
      { href: toLocalizedPath("toolHouseholdBudget", locale) },
      { href: toLocalizedPath("toolInvestmentReturn", locale) },
    ];
    expect(getRelatedContentTools(sources, locale, t).filter((item) => item.href === href)).toHaveLength(1);
    expect(getRelatedContentTools([...sources, { href }], locale, t).some((item) => item.href === href)).toBe(false);
  });
});
