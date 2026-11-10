import { describe, expect, it } from "vitest"
import { toOgLocale } from "./ogLocale"

describe("toOgLocale", () => {
	it("maps app languages and locale variants to OG locales", () => {
		expect(toOgLocale("pt")).toBe("pt_PT")
		expect(toOgLocale("en")).toBe("en_GB")
		expect(toOgLocale("es")).toBe("es_ES")
		expect(toOgLocale("fr")).toBe("fr_FR")
		expect(toOgLocale("de")).toBe("de_DE")
		expect(toOgLocale("it")).toBe("it_IT")
		expect(toOgLocale("en-US")).toBe("en_GB")
		expect(toOgLocale("pt-PT")).toBe("pt_PT")
		expect(toOgLocale("unknown")).toBe("en_GB")
	})
})
