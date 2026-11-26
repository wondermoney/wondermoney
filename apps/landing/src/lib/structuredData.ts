/**
 * Schema.org structured data shared across pages: the WonderMoney organization (every page, from
 * Layout.astro), the website (the homepage) and the tool pages' graph (`buildToolStructuredData`).
 *
 * Structured data states only what the page itself shows: the visible title, the dek, the
 * breadcrumb trail, the FAQ the page prints (`buildFaqPageSchema`), the app's stores and price
 * as the home page's FAQ gives them, and for the data-snapshot tools the source and date the page
 * prints. No ratings, prices or FAQ entries the page does not carry (search engines penalise that).
 */
import type { FaqEntry } from "./faq"
import type { Lang } from "./i18nLocale"
import { ogImageFor, toolOgCard } from "./og/ogImages"
import { toOgLocale } from "./ogLocale"
import { toLocalizedPath, toToolsHubPath, type ToolRouteId } from "./routes"
import { APP_STORE_URL, PLAY_STORE_URL, WEB_APP_URL } from "./storeLinks"
import { getToolCatalogEntry } from "./toolsCatalog"
import { getTranslations } from "./translations"
import { DATASET_TOOL_ROUTE_IDS, loadToolDatasets, type DatasetToolRouteId } from "./toolDatasets"

export const SITE_URL = "https://wonder.money"
export const ORGANIZATION_ID = `${SITE_URL}/#organization`
export const WEBSITE_ID = `${SITE_URL}/#website`

type JsonLd = Record<string, unknown>

/** The organization behind the site, on every page. */
export const ORGANIZATION_SCHEMA: JsonLd = {
	"@context": "https://schema.org",
	"@type": "Organization",
	"@id": ORGANIZATION_ID,
	name: "WonderMoney",
	url: SITE_URL,
	logo: `${SITE_URL}/logo.png`,
	description: "The central financial hub for Europeans",
	sameAs: ["https://discord.gg/9qKZ7gEaAP"],
}

/** A reference to the organization, for `publisher` and `creator`. */
const ORGANIZATION_REF: JsonLd = {
	"@type": "Organization",
	"@id": ORGANIZATION_ID,
	name: "WonderMoney",
	url: SITE_URL,
}

/** BCP 47 language of a locale's pages: `pt-PT`, `en-GB`. */
export function inLanguage(locale: Lang): string {
	return toOgLocale(locale).replace("_", "-")
}

/** The website, on the homepage. */
export function buildWebSiteSchema(locale: Lang): JsonLd {
	return {
		"@context": "https://schema.org",
		"@type": "WebSite",
		"@id": WEBSITE_ID,
		name: "WonderMoney",
		url: SITE_URL,
		inLanguage: inLanguage(locale),
		publisher: { "@id": ORGANIZATION_ID },
	}
}

/** A page's FAQ as `FAQPage`: the entries it renders, question and answer text as printed. */
export function buildFaqPageSchema(entries: ReadonlyArray<FaqEntry>): JsonLd {
	return {
		"@context": "https://schema.org",
		"@type": "FAQPage",
		mainEntity: entries.map(({ question, answer }) => ({
			"@type": "Question",
			name: question,
			acceptedAnswer: { "@type": "Answer", text: answer },
		})),
	}
}

/**
 * WonderMoney itself, on the home page: free (the FAQ's "Is WonderMoney free?"), on the web,
 * iOS and Android, with the store links the FAQ's app question shows.
 */
export function buildSoftwareApplicationSchema(locale: Lang): JsonLd {
	return {
		"@context": "https://schema.org",
		"@type": "SoftwareApplication",
		name: "WonderMoney",
		url: WEB_APP_URL,
		inLanguage: inLanguage(locale),
		applicationCategory: "FinanceApplication",
		operatingSystem: "Web, iOS, Android",
		isAccessibleForFree: true,
		offers: {
			"@type": "Offer",
			price: "0",
			priceCurrency: "EUR",
		},
		downloadUrl: [APP_STORE_URL, PLAY_STORE_URL],
		publisher: ORGANIZATION_REF,
	}
}

/**
 * A tool page's structured data: the tool as a WebApplication, its breadcrumb trail as the hero
 * shows it (home, tools, the tool), and for a data-snapshot tool a Dataset.
 */
export async function buildToolStructuredData(routeId: ToolRouteId, locale: Lang): Promise<JsonLd[]> {
	const t = getTranslations(locale)
	const { key } = getToolCatalogEntry(routeId)
	const url = `${SITE_URL}${toLocalizedPath(routeId, locale)}`
	const name = t(`tools.${key}.title`)
	const description = t(`tools.${key}.subtitle`)
	const image = `${SITE_URL}${ogImageFor(toolOgCard(routeId, locale)).src}`
	const language = inLanguage(locale)

	const webApplication: JsonLd = {
		"@context": "https://schema.org",
		"@type": "WebApplication",
		name,
		description,
		url,
		image,
		inLanguage: language,
		applicationCategory: "FinanceApplication",
		operatingSystem: "Web",
		isAccessibleForFree: true,
		offers: {
			"@type": "Offer",
			price: "0",
			priceCurrency: "EUR",
		},
		publisher: ORGANIZATION_REF,
	}

	const breadcrumbs: JsonLd = {
		"@context": "https://schema.org",
		"@type": "BreadcrumbList",
		itemListElement: [
			{ name: t("nav.home"), item: `${SITE_URL}/${locale}` },
			{ name: t("header.tools"), item: `${SITE_URL}${toToolsHubPath(locale)}` },
			{ name, item: url },
		].map((crumb, index) => ({ "@type": "ListItem", position: index + 1, ...crumb })),
	}

	const source = (DATASET_TOOL_ROUTE_IDS as readonly ToolRouteId[]).includes(routeId)
		? (await loadToolDatasets())[routeId as DatasetToolRouteId]
		: undefined
	const dataset: JsonLd | null = source
		? {
				"@context": "https://schema.org",
				"@type": "Dataset",
				name,
				description,
				url,
				inLanguage: language,
				isAccessibleForFree: true,
				dateModified: source.dateModified,
				creator: source.creator,
				publisher: ORGANIZATION_REF,
				...(source.isBasedOn && { isBasedOn: source.isBasedOn }),
				...(source.temporalCoverage && { temporalCoverage: source.temporalCoverage }),
			}
		: null

	return dataset ? [webApplication, breadcrumbs, dataset] : [webApplication, breadcrumbs]
}
