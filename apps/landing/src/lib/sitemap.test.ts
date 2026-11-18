import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it, vi } from "vitest"
import { getLegacyRedirects } from "./legacySlugs"
import {
	getAdLandingStaticPaths,
	getFeatureStaticPaths,
	getToolStaticPaths,
	getTopLevelPageStaticPaths,
} from "./pageStaticPaths"
import { SUPPORTED_LANGS, type Lang } from "./routes"
import { isSitemapPage } from "./sitemap"

// pageStaticPaths imports the Sanity client for the content routes; these paths never call it.
vi.mock("sanity:client", () => ({ sanityClient: { fetch: vi.fn() } }))

const SITE = "https://wonder.money"

function readSource(relativePath: string): string {
	return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8")
}

// The prerendered pages with a legacy alias, as the route files build their addresses.
const SECTIONS = [
	{ routeFile: "[page].astro", prefix: "", paths: (lang: Lang) => getTopLevelPageStaticPaths(lang).map(({ params, props }) => ({ slug: params.page, props })) },
	{ routeFile: "features/[feature].astro", prefix: "features/", paths: (lang: Lang) => getFeatureStaticPaths(lang).map(({ params, props }) => ({ slug: params.feature, props })) },
	{ routeFile: "tools/[tool].astro", prefix: "tools/", paths: (lang: Lang) => getToolStaticPaths(lang).map(({ params, props }) => ({ slug: params.tool, props })) },
] as const

function builtPages(lang: Lang) {
	return SECTIONS.flatMap(({ prefix, paths }) =>
		paths(lang).map(({ slug, props }) => ({
			path: `/${lang}/${prefix}${slug}`,
			redirectTo: props.redirectTo && `/${lang}/${prefix}${props.redirectTo}`,
		})),
	)
}

describe("sitemap filter", () => {
	it.each(SUPPORTED_LANGS)("leaves every redirect page in %s out and keeps every other page", (lang) => {
		const pages = builtPages(lang)
		const redirects = pages.filter((page) => page.redirectTo)
		const canonical = pages.filter((page) => !page.redirectTo)

		expect(canonical.length).toBeGreaterThan(0)
		for (const { path } of redirects) expect(isSitemapPage(`${SITE}${path}`), path).toBe(false)
		for (const { path } of canonical) expect(isSitemapPage(`${SITE}${path}`), path).toBe(true)
	})

	it("lists exactly the redirect pages the static paths generate", () => {
		const generated = SUPPORTED_LANGS.flatMap((lang) =>
			builtPages(lang).flatMap(({ path, redirectTo }) =>
				redirectTo ? [{ source: path, destination: redirectTo }] : [],
			),
		)

		expect(generated.length).toBeGreaterThan(0)
		expect(getLegacyRedirects()).toEqual(expect.arrayContaining(generated))
		expect(getLegacyRedirects()).toHaveLength(generated.length)
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

	it("is the filter astro.config.mjs gives @astrojs/sitemap", () => {
		const config = readSource("../../astro.config.mjs")
		expect(config).toContain('import { isSitemapPage } from "./src/lib/sitemap.ts"')
		expect(config).toMatch(/sitemap\(\{[\s\S]*filter: isSitemapPage,[\s\S]*\}\)/)
	})
})

describe("legacy addresses", () => {
	it.each(SUPPORTED_LANGS)("each one in %s still 301s to a localized page that exists", (lang) => {
		const pages = builtPages(lang)
		const canonicalPaths = new Set(pages.filter((page) => !page.redirectTo).map((page) => page.path))
		const legacy = getLegacyRedirects([lang])

		if (lang !== "en") expect(legacy.length).toBeGreaterThan(0)
		for (const { source, destination } of legacy) {
			expect(pages).toContainEqual({ path: source, redirectTo: destination })
			expect(canonicalPaths.has(destination), destination).toBe(true)
			expect(canonicalPaths.has(source), source).toBe(false)
		}

		for (const { routeFile, prefix } of SECTIONS) {
			expect(readSource(`../pages/${lang}/${routeFile}`)).toContain(
				`return Astro.redirect(\`/${lang}/${prefix}\${redirectTo}\`, 301);`,
			)
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
