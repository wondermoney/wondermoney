import { describe, expect, it } from "vitest"
import { getLegacyRedirects } from "./legacySlugs"
import {
	getAdLandingStaticPaths,
	getFeatureStaticPaths,
	getToolStaticPaths,
	getTopLevelPageStaticPaths,
} from "./pageStaticPaths"
import { SUPPORTED_LANGS, type Lang } from "./routes"
import { isSitemapPage } from "./sitemap"

const SITE = "https://wonder.money"

function builtPages(lang: Lang) {
	return new Set([
		...getTopLevelPageStaticPaths(lang).map(({ params }) => `/${lang}/${params.page}`),
		...getFeatureStaticPaths(lang).map(({ params }) => `/${lang}/features/${params.feature}`),
		...getToolStaticPaths(lang).map(({ params }) => `/${lang}/tools/${params.tool}`),
	])
}

describe("sitemap filter", () => {
	it.each(SUPPORTED_LANGS)("keeps canonical pages and excludes legacy addresses in %s", (lang) => {
		for (const path of builtPages(lang)) expect(isSitemapPage(`${SITE}${path}`), path).toBe(true)
		for (const { source } of getLegacyRedirects([lang])) {
			expect(isSitemapPage(`${SITE}${source}`), source).toBe(false)
		}
	})

	it("leaves out the legacy tool and top-level addresses the issue names", () => {
		expect(isSitemapPage(`${SITE}/pt/tools/compound-interest-calculator`)).toBe(false)
		expect(isSitemapPage(`${SITE}/pt/tools/savings-rate-calculator`)).toBe(false)
		expect(isSitemapPage(`${SITE}/pt/fire-calculator`)).toBe(false)
		expect(isSitemapPage(`${SITE}/pt/fire-calculator/`)).toBe(false)
		expect(isSitemapPage(`${SITE}/pt/tools/juros-compostos`)).toBe(true)
		// English addresses are the legacy slugs themselves, and canonical there.
		expect(isSitemapPage(`${SITE}/en/tools/compound-interest-calculator`)).toBe(true)
		expect(isSitemapPage(`${SITE}/en/fire-calculator`)).toBe(true)
		expect(isSitemapPage(`${SITE}/pt`)).toBe(true)
	})

	it.each(SUPPORTED_LANGS)("leaves the %s ad landing pages out", (lang) => {
		const adPages = getAdLandingStaticPaths(lang)
		expect(adPages.length).toBeGreaterThan(0)
		for (const { params } of adPages) expect(isSitemapPage(`${SITE}/${lang}/go/${params.ad}`)).toBe(false)
	})
})

describe("legacy addresses", () => {
	it.each(SUPPORTED_LANGS)("points each alias in %s to a generated page", (lang) => {
		const pages = builtPages(lang)
		const legacy = getLegacyRedirects([lang])

		if (lang !== "en") expect(legacy.length).toBeGreaterThan(0)
		expect(new Set(legacy.map(({ source }) => source)).size).toBe(legacy.length)
		for (const { source, destination } of legacy) {
			expect(pages.has(source), source).toBe(false)
			expect(pages.has(destination), destination).toBe(true)
		}
	})

	it("redirects the addresses the issue names", () => {
		expect(getLegacyRedirects()).toEqual(
			expect.arrayContaining([
				{ source: "/pt/tools/compound-interest-calculator", destination: "/pt/tools/juros-compostos" },
				{ source: "/pt/tools/savings-rate-calculator", destination: "/pt/tools/taxa-poupanca" },
				{ source: "/de/tools/compound-interest-calculator", destination: "/de/tools/zinseszins-rechner" },
			]),
		)
		expect(getLegacyRedirects(["pt"]).map(({ source }) => source)).toContain("/pt/fire-calculator")
	})
})
