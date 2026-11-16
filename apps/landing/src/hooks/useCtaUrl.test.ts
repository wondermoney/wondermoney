import { describe, expect, it } from "vitest"

import { SUPPORTED_LANGS } from "../lib/i18nLocale"
import { getTranslations } from "../lib/translations"

import { CTA_URL, DEMO_URL } from "./useCtaUrl"

describe("Try the demo", () => {
	it("links to the app's sign-in page with the flag that starts the demo there", () => {
		const demo = new URL(DEMO_URL)

		// The demo session cookie is set on the app's origin, the same one sign-up lives on.
		expect(demo.origin).toBe(new URL(CTA_URL).origin)
		expect(demo.pathname).toBe("/auth/login")
		expect([...demo.searchParams]).toEqual([["demo", "1"]])
	})

	it("has its own label in every locale, apart from the sign-up action", () => {
		for (const lang of SUPPORTED_LANGS) {
			const t = getTranslations(lang)
			const label = t("global.demoCta")

			expect(label, lang).toMatch(/\S/)
			expect(label, lang).not.toBe(t("global.mainCta"))
			expect(label, lang).not.toBe(t("homepage.hero.newCta"))
		}
	})
})
