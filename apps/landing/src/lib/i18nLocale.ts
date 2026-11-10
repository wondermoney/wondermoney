export const SUPPORTED_LANGS = ["pt", "en", "es", "fr", "de", "it"] as const

export type Lang = (typeof SUPPORTED_LANGS)[number]

export const DEFAULT_LOCALE: Lang = "pt"

export function toLang(input?: string): Lang {
	const normalized = (input ?? DEFAULT_LOCALE).toLowerCase()

	if (normalized.startsWith("en")) return "en"
	if (normalized.startsWith("es")) return "es"
	if (normalized.startsWith("fr")) return "fr"
	if (normalized.startsWith("de")) return "de"
	if (normalized.startsWith("it")) return "it"

	return DEFAULT_LOCALE
}

export function buildLocaleStaticPaths() {
	return SUPPORTED_LANGS.map((locale) => ({ params: { locale } }))
}

export function getPathLocale(pathname: string): Lang | undefined {
	const firstSegment = pathname.split("/").filter(Boolean)[0]

	if (!firstSegment) {
		return undefined
	}

	const locale = toLang(firstSegment)

	return firstSegment.toLowerCase() === locale ? locale : undefined
}

export function getLocalizedPathname(pathname: string, locale: Lang): string {
	const normalizedPathname = pathname.split(/[?#]/)[0] || "/"
	const segments = normalizedPathname.split("/").filter(Boolean)
	const hasPrefix = getPathLocale(normalizedPathname)
	const localizedSegments = hasPrefix ? segments.slice(1) : segments

	if (localizedSegments.length === 0) {
		return `/${locale}`
	}

	return `/${locale}/${localizedSegments.join("/")}`
}
