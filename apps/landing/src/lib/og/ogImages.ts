/**
 * The social preview (OpenGraph) image of each page that has its own: every tool page, the tools
 * hub, every feature page and every learn guide without an `ogImage` of its own, in each locale.
 * `src/pages/og/[...path].ts` draws them at build time (`renderOgImage.ts`) and serves them as
 * static files at `/og/<page path>.png`; a page links its image through `SEO.astro`. Every other
 * page keeps `/og-default.png`.
 *
 * This module only decides what each image says. It imports no canvas, so pages and tests can
 * read it.
 */
import { BookOpen, LayoutGrid, type LucideIcon } from "lucide-react"
import { FEATURE_MENU } from "../featureMenu"
import { SUPPORTED_LANGS, type Lang } from "../i18nLocale"
import { toLocalizedPath, toToolsHubPath } from "../routes"
import { TOOLS_IN_DISPLAY_ORDER, type CatalogRouteId } from "../toolsCatalog"
import { getTranslations } from "../translations"

export const OG_IMAGE_WIDTH = 1200
export const OG_IMAGE_HEIGHT = 630
export const DEFAULT_OG_IMAGE = "/og-default.png"

/** What one generated image shows. */
export interface OgCard {
	/** The page the image belongs to, without the host: `/en/tools/mortgage-calculator`. */
	readonly pagePath: string
	readonly locale: Lang
	/** The section the page sits in, above the title: "Tools", "Features", "Learn". */
	readonly eyebrow: string
	/** The page's visible title (its h1 or the name the menus give it). */
	readonly title: string
	/** One line under the title; the image cuts it to two lines. */
	readonly subtitle?: string
	readonly icon: LucideIcon
}

/** The image a page links in `og:image` and `twitter:image`. */
export interface OgImage {
	/** Site-relative path of the PNG: `/og/en/tools/mortgage-calculator.png`. */
	readonly src: string
	/** Alt text: the image shows the title and the WonderMoney wordmark. */
	readonly alt: string
}

/** Where a page's generated image is served: `/en/tools/x` gives `/og/en/tools/x.png`. */
export function ogImagePath(pagePath: string): string {
	const trimmed = pagePath.replace(/^\/+|\/+$/g, "")
	if (!trimmed) throw new Error("A generated OG image needs a page path below the site root")
	return `/og/${trimmed}.png`
}

export function ogImageFor(card: OgCard): OgImage {
	return { src: ogImagePath(card.pagePath), alt: `${card.title} · WonderMoney` }
}

/** The image of a tool page (or of the FIRE calculator, which the catalog lists with them). */
export function toolOgCard(routeId: CatalogRouteId, locale: Lang): OgCard {
	const tool = TOOLS_IN_DISPLAY_ORDER.find((entry) => entry.routeId === routeId)
	if (!tool) throw new Error(`Tool missing from the tools catalog: ${routeId}`)
	const t = getTranslations(locale)

	return {
		pagePath: toLocalizedPath(tool.routeId, locale),
		locale,
		eyebrow: t("header.tools"),
		title: t(`tools.${tool.key}.title`),
		subtitle: t(`tools.${tool.key}.description`),
		icon: tool.icon,
	}
}

export function toolsHubOgCard(locale: Lang): OgCard {
	const t = getTranslations(locale)

	return {
		pagePath: toToolsHubPath(locale),
		locale,
		eyebrow: t("header.tools"),
		title: t("tools.hub.title"),
		subtitle: t("tools.hub.description"),
		icon: LayoutGrid,
	}
}

export function featureOgCard(routeId: (typeof FEATURE_MENU)[number]["routeId"], locale: Lang): OgCard {
	const feature = FEATURE_MENU.find((item) => item.routeId === routeId)
	if (!feature) throw new Error(`Feature missing from the features menu: ${routeId}`)
	const t = getTranslations(locale)

	return {
		pagePath: toLocalizedPath(feature.routeId, locale),
		locale,
		eyebrow: t("header.features"),
		title: t(`header.nav.${feature.key}.name`),
		subtitle: t(`header.nav.${feature.key}.description`),
		icon: feature.icon,
	}
}

/** A learn guide's image, for a guide whose frontmatter sets no `ogImage`. */
export function guideOgCard(guide: { locale: Lang; slug: string; title: string; excerpt?: string }): OgCard {
	const t = getTranslations(guide.locale)

	return {
		pagePath: `/${guide.locale}/learn/${guide.slug}`,
		locale: guide.locale,
		eyebrow: t("footer.learn"),
		title: guide.title,
		subtitle: guide.excerpt,
		icon: BookOpen,
	}
}

/** Every generated image that does not come from the content collections, in every locale. */
export function listStaticOgCards(langs: readonly Lang[] = SUPPORTED_LANGS): OgCard[] {
	return langs.flatMap((locale) => [
		toolsHubOgCard(locale),
		...TOOLS_IN_DISPLAY_ORDER.map((tool) => toolOgCard(tool.routeId, locale)),
		...FEATURE_MENU.map((feature) => featureOgCard(feature.routeId, locale)),
	])
}
