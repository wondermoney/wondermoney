import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

function readSource(relative: string) {
	return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8")
}

const page = readSource("../../components/pages/ToolDetailPage.astro")
const guides = [...page.matchAll(/import \w+ from "@\/components\/calculators\/(\w+)\.astro"/g)].map(
	(match) => match[1],
)

describe("calculator guides (Direction B)", () => {
	it("finds the guides the tool page renders", () => {
		expect(guides.length).toBeGreaterThan(35)
		expect(guides).toContain("EmergencyFundMethod")
		expect(guides).toContain("IndexProjectionGuide")
	})

	it.each(guides)("%s is written in the shared guide column", (name) => {
		const source = readSource(`../../components/calculators/${name}.astro`)
		const template = source.slice(source.indexOf("---", 3) + 3).trim()
		expect(source).toContain('import ToolGuide from "./ToolGuide.astro"')
		expect(template.startsWith("<ToolGuide>")).toBe(true)
		expect(template.endsWith("</ToolGuide>")).toBe(true)
	})

	it("opens every page with the article hero and ends with figure cards", () => {
		expect(page).toContain("<ArticleHero")
		expect(page).toContain("figure={figureForTool(routeId)}")
		expect(page).toContain("<FigureCards")
		expect(page).toContain('variant="card"')
		expect(page).not.toContain("RelatedContent")
	})
})
