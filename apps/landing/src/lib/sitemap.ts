// The @astrojs/sitemap filter (astro.config.mjs). The sitemap lists canonical addresses only.
import { getLegacyRedirects } from "./legacySlugs"
import { loadToolDatasets, toolDataLastmod } from "./toolDatasets"

const LEGACY_REDIRECT_PATHS = new Set(getLegacyRedirects().map(({ source }) => source))

/** Whether a built page's URL belongs in the sitemap. */
export function isSitemapPage(url: string): boolean {
	const pathname = new URL(url).pathname.replace(/\/+$/, "")

	// Paid-traffic ad landing pages are noindex,follow and must never compete for organic
	// rankings.
	if (/\/go\//.test(pathname)) return false

	// Legacy addresses redirect to the localized address.
	return !LEGACY_REDIRECT_PATHS.has(pathname)
}

/**
 * The @astrojs/sitemap `serialize` hook: dates a data-snapshot tool page with its data's date.
 * Other pages carry no `lastmod`, rather than a build date that changes on every deploy. The data
 * is loaded while the config loads: the hook runs after the build, when no module can be imported.
 */
export async function createSitemapSerializer(): Promise<
	<T extends { url: string; lastmod?: string }>(item: T) => T
> {
	const sources = await loadToolDatasets()
	return (item) => {
		const lastmod = toolDataLastmod(new URL(item.url).pathname, sources)
		return lastmod ? { ...item, lastmod } : item
	}
}
