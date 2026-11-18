// The @astrojs/sitemap filter (astro.config.mjs). The sitemap lists canonical addresses only.
import { getLegacyRedirects } from "./legacySlugs"

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
