import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { scanContent } from "../../scripts/claims-alignment.mjs"
import { buildLlmsTxt, llmsTxtPath, type LlmsGuide } from "./llmsTxt"
import { getFeatureStaticPaths } from "./pageStaticPaths"
import { SUPPORTED_LANGS, toLocalizedPath, toToolsHubPath } from "./routes"
import { TOOLS_IN_DISPLAY_ORDER } from "./toolsCatalog"

const SITE = "https://wonder.money"
const GUIDES: LlmsGuide[] = [{ slug: "build-monthly-budget", title: "How to build a monthly budget", excerpt: "A first budget\nin four steps." }]

const links = (text: string) => [...text.matchAll(/^- \[([^\]]+)\]\(([^)]+)\)(?::\s(.+))?$/gmu)].map(([, name, url, description]) => ({ name, url, description }))

describe("llms.txt", () => {
	describe.each(SUPPORTED_LANGS)("%s", (locale) => {
		const text = buildLlmsTxt(locale, GUIDES)

		it("opens with the name, a one-line summary and the paragraph on what WonderMoney is", () => {
			const [title, , summary, , about] = text.split("\n")
			expect(title).toBe("# WonderMoney")
			expect(summary).toMatch(/^> \S/u)
			expect(about?.length).toBeGreaterThan(200)
		})

		it("lists the home page, every feature and tool page and the guides, and only those of the site", () => {
			const sitePaths = links(text)
				.map(({ url }) => url)
				.filter((url) => url.startsWith(`${SITE}/`))
				.map((url) => new URL(url).pathname)
			const pages = [
				`/${locale}`,
				...getFeatureStaticPaths(locale).map(({ props }) => toLocalizedPath(props.routeId, locale)),
				toToolsHubPath(locale),
				...TOOLS_IN_DISPLAY_ORDER.map(({ routeId }) => toLocalizedPath(routeId, locale)),
				`/${locale}/learn/build-monthly-budget`,
			]
			const otherLlmsFiles = SUPPORTED_LANGS.filter((other) => other !== locale).map((other) => llmsTxtPath(other))

			expect(new Set(sitePaths).size).toBe(sitePaths.length)
			expect([...sitePaths].sort()).toEqual([...pages, ...otherLlmsFiles].sort())
		})

		it("gives every link a one-line description", () => {
			for (const { name, url, description } of links(text)) {
				expect(name.trim()).not.toBe("")
				if (!url.endsWith("/llms.txt")) expect(description?.trim()).toBeTruthy()
			}
			expect(text).toContain("A first budget in four steps.")
		})

		it("makes no claim the claims check refuses", () => {
			expect(scanContent(`llms-${locale}.txt`, text)).toEqual([])
		})
	})

	it("leaves out the guides section where the locale has none", () => {
		expect(buildLlmsTxt("fr", [])).not.toMatch(/\/learn\//u)
	})
})

describe("robots.txt", () => {
	const robots = readFileSync(new URL("../../public/robots.txt", import.meta.url), "utf8")

	it.each(["OAI-SearchBot", "ChatGPT-User", "GPTBot", "PerplexityBot", "ClaudeBot", "Google-Extended"])("allows %s", (agent) => {
		const group = robots.split(/\n\s*\n/u).find((block) => block.includes(`User-agent: ${agent}\n`))
		expect(group).toMatch(/^Allow: \/$/mu)
		expect(group).not.toMatch(/^Disallow:/mu)
	})

	it("keeps every page open and the sitemap line", () => {
		expect(robots).toMatch(/^User-agent: \*\nAllow: \/$/mu)
		expect(robots).not.toMatch(/^Disallow:/mu)
		expect(robots).toContain("Sitemap: https://wonder.money/sitemap-index.xml")
	})
})
