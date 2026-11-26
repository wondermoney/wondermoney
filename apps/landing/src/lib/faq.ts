import type { Lang } from "./i18nLocale"
import type { FeatureRouteId } from "./pageStaticPaths"
import { APP_STORE_URL, PLAY_STORE_URL } from "./appLinks"
import { getTranslations } from "./translations"

/**
 * The FAQs the home page and the feature pages show. Each page renders these entries and builds
 * its `FAQPage` JSON-LD from the same list (`buildFaqPageSchema`), so the structured data holds
 * exactly the questions and answers on the page.
 */
export type FaqLink = Readonly<{ label: string; href: string }>

export type FaqEntry = Readonly<{
	question: string
	answer: string
	/** Links shown under the answer, such as the app stores. */
	links?: ReadonlyArray<FaqLink>
}>

/**
 * The home page's questions, in the order it shows them: the ones people ask assistants about a
 * personal finance app (is it free, is it safe, which banks, can I host it, is there an app, how
 * it compares), then investments.
 */
export const HOMEPAGE_FAQ_KEYS = ["faq3", "faq1", "faq2", "faq6", "faq7", "faq8", "faq5"] as const

export function homepageFaq(locale: Lang): FaqEntry[] {
	const t = getTranslations(locale)
	return HOMEPAGE_FAQ_KEYS.map((key) => ({
		question: t(`homepage.faq.${key}.question`),
		answer: t(`homepage.faq.${key}.answer`),
		...(key === "faq7" && {
			links: [
				{ label: t("homepage.faq.faq7.appStore"), href: APP_STORE_URL },
				{ label: t("homepage.faq.faq7.googlePlay"), href: PLAY_STORE_URL },
			],
		}),
	}))
}

/** Every feature page shows three questions, `lp.<route id>.faq{1,2,3}{Q,A}`, under `faqTitle`. */
export const FEATURE_FAQ_NUMBERS = [1, 2, 3] as const

export function featureFaq(locale: Lang, routeId: FeatureRouteId): FaqEntry[] {
	const t = getTranslations(locale)
	return FEATURE_FAQ_NUMBERS.map((n) => ({
		question: t(`lp.${routeId}.faq${n}Q`),
		answer: t(`lp.${routeId}.faq${n}A`),
	}))
}
