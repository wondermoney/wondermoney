import { describe, expect, it } from "vitest"
import { FEATURE_ROUTE_IDS, SUPPORTED_LANGS, toLocalizedPath, toToolsHubPath } from "../routes"
import { TOOLS_CATALOG } from "../toolsCatalog"
import { getTranslations } from "../translations"
import { guideOgCard, listStaticOgCards, ogImageFor, ogImagePath, toolOgCard } from "./ogImages"

describe("ogImagePath", () => {
	it("serves a page's image under /og at the page's own path", () => {
		expect(ogImagePath("/en/tools/mortgage-calculator")).toBe("/og/en/tools/mortgage-calculator.png")
		expect(ogImagePath("/pt/tools/")).toBe("/og/pt/tools.png")
	})

	it("refuses the site root", () => {
		expect(() => ogImagePath("/")).toThrow()
	})
})

describe("listStaticOgCards", () => {
	const cards = listStaticOgCards()
	const paths = cards.map((card) => card.pagePath)

	it("has one image per tool, the tools hub and every feature page, in every locale", () => {
		for (const locale of SUPPORTED_LANGS) {
			expect(paths).toContain(toToolsHubPath(locale))
			for (const tool of TOOLS_CATALOG) expect(paths).toContain(toLocalizedPath(tool.routeId, locale))
			for (const routeId of FEATURE_ROUTE_IDS) expect(paths).toContain(toLocalizedPath(routeId, locale))
		}
		expect(cards).toHaveLength(SUPPORTED_LANGS.length * (1 + TOOLS_CATALOG.length + FEATURE_ROUTE_IDS.length))
	})

	it("never gives two pages the same image", () => {
		const images = cards.map((card) => ogImagePath(card.pagePath))
		expect(new Set(images).size).toBe(images.length)
	})

	it("shows the localized title and section, with alt text naming the page", () => {
		for (const card of cards) {
			expect(card.title.trim(), card.pagePath).not.toBe("")
			expect(card.eyebrow.trim(), card.pagePath).not.toBe("")
			expect(card.title, card.pagePath).not.toMatch(/\{\{/)
			expect(ogImageFor(card).alt).toBe(`${card.title} · WonderMoney`)
		}
	})
})

describe("toolOgCard", () => {
	it("uses the tool's visible title and its catalog icon", () => {
		const card = toolOgCard("toolMortgage", "pt")
		const entry = TOOLS_CATALOG.find((tool) => tool.routeId === "toolMortgage")
		expect(card.title).toBe(getTranslations("pt")("tools.mortgage.title"))
		expect(card.eyebrow).toBe(getTranslations("pt")("header.tools"))
		expect(card.icon).toBe(entry?.icon)
	})
})

describe("guideOgCard", () => {
	it("points at the guide's learn address", () => {
		expect(guideOgCard({ locale: "en", slug: "budgeting-basics", title: "Budgeting basics" }).pagePath).toBe(
			"/en/learn/budgeting-basics",
		)
	})
})
