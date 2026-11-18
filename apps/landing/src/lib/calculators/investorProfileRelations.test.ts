import { describe, expect, it } from "vitest";
import { getRelatedContentTools } from "../relatedContentTools";
import { SUPPORTED_LANGS, toLocalizedPath } from "../routes";
import { getTranslations } from "../translations";

describe("investor profile quiz related content", () => {
  it.each(SUPPORTED_LANGS)("links to the quiz from investment content in %s", (locale) => {
    const translate = getTranslations(locale);
    const href = toLocalizedPath("toolInvestorProfile", locale);

    for (const source of ["toolCompoundInterest", "toolInvestmentReturn"] as const) {
      const items = [{ href: toLocalizedPath(source, locale) }];
      expect(getRelatedContentTools(items, locale, translate)).toContainEqual({
        href,
        title: translate("tools.investorProfile.title"),
        description: "",
        type: "calculator",
      });
      expect(getRelatedContentTools([...items, { href }], locale, translate)).not.toContainEqual(
        expect.objectContaining({ href }),
      );
    }
  });
});
