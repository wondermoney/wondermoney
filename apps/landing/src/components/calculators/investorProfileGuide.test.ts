import { describe, expect, it } from "vitest"
import { SUPPORTED_LANGS } from "@/lib/routes"
import { getTranslations } from "@/lib/translations"
import { buildInvestorProfileGuide, investorProfileExampleScore } from "./investorProfileGuide"

describe("investor profile guide content", () => {
	it("scores the example as the quiz does: capacity 2, comfort 6, the lower band", () => {
		expect(investorProfileExampleScore()).toEqual({ capacity: 2, comfort: 6, band: "lower" })
	})

	it.each(SUPPORTED_LANGS)("labels the example's figures with the quiz's own words in %s", (lang) => {
		const t = getTranslations(lang)
		const guide = buildInvestorProfileGuide(lang)

		expect(guide.figures.map((figure) => figure.label)).toEqual([
			t("tools.investorProfile.capacityLabel"),
			t("tools.investorProfile.comfortLabel"),
			t("tools.investorProfile.results.lower.title"),
		])
		expect(guide.figures[0].value).toMatch(/^2 \/ 6$/)
		expect(guide.figures[1].value).toMatch(/^6 \/ 6$/)
		// The example sentence quotes the same scores.
		expect(t("tools.investorProfile.example")).toMatch(/2/)
		expect(t("tools.investorProfile.example")).toMatch(/6/)
	})
})
