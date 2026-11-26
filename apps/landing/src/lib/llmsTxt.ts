/**
 * `/llms.txt` and `/{locale}/llms.txt` (llmstxt.org): what WonderMoney is, in one paragraph, and
 * the site's home, feature, tool and guide pages with one line each, for AI assistants that read
 * and cite the site. Built at build time from the route map and the same copy the pages show, so
 * a page is listed exactly when it is built, and the copy goes through the claims and offer
 * checks with the rest of the catalogue (`llms.*` in the locale files).
 */
import { FEATURE_MENU } from "./featureMenu"
import { SUPPORTED_LANGS, type Lang } from "./i18nLocale"
import { GITHUB_URL, selfHostingDocsUrl } from "./openSource"
import { toLocalizedPath, toToolsHubPath } from "./routes"
import { APP_STORE_URL, PLAY_STORE_URL, WEB_APP_URL } from "./appLinks"
import { SITE_URL } from "./structuredData"
import { TOOLS_IN_DISPLAY_ORDER } from "./toolsCatalog"
import { getTranslations } from "./translations"

/** A learn guide as the page lists it: its slug in the locale, title and one-line excerpt. */
export type LlmsGuide = Readonly<{ slug: string; title: string; excerpt: string }>

/** Languages docs.wonder.money is written in; the rest read the English docs. */
const DOCS_LANGS: ReadonlyArray<Lang> = ["en", "pt", "es"]

const LANGUAGE_NAMES: Record<Lang, string> = {
	pt: "Português",
	en: "English",
	es: "Español",
	fr: "Français",
	de: "Deutsch",
	it: "Italiano",
}

export function llmsTxtPath(locale?: Lang): string {
	return locale ? `/${locale}/llms.txt` : "/llms.txt"
}

// One line of a list: never a line break inside it, whatever the copy holds.
const oneLine = (text: string) => text.replace(/\s+/gu, " ").trim()
const link = (name: string, url: string, description?: string) =>
	`- [${oneLine(name)}](${url})${description ? `: ${oneLine(description)}` : ""}`

/** The locale's llms.txt. `guides` are the learn guides built in that locale (none in some). */
export function buildLlmsTxt(locale: Lang, guides: ReadonlyArray<LlmsGuide>): string {
	const t = getTranslations(locale)
	const docsLang = DOCS_LANGS.includes(locale) ? locale : "en"

	const sections: Array<[string, string[]]> = [
		[
			t("llms.sections.start"),
			[
				link(t("llms.links.home"), `${SITE_URL}/${locale}`, t("homepage.metaDescription")),
				link(t("llms.links.webApp"), WEB_APP_URL, t("llms.links.webAppDescription")),
				link(t("llms.links.appStore"), APP_STORE_URL, t("llms.links.appStoreDescription")),
				link(t("llms.links.googlePlay"), PLAY_STORE_URL, t("llms.links.googlePlayDescription")),
			],
		],
		[
			t("llms.sections.features"),
			FEATURE_MENU.map(({ routeId, key }) =>
				link(t(`header.nav.${key}.name`), `${SITE_URL}${toLocalizedPath(routeId, locale)}`, t(`header.nav.${key}.description`)),
			),
		],
		[
			t("llms.sections.tools"),
			[
				link(t("tools.hub.title"), `${SITE_URL}${toToolsHubPath(locale)}`, t("tools.hub.description")),
				...TOOLS_IN_DISPLAY_ORDER.map(({ routeId, key }) =>
					link(t(`tools.${key}.title`), `${SITE_URL}${toLocalizedPath(routeId, locale)}`, t(`tools.${key}.description`)),
				),
			],
		],
		[
			t("llms.sections.guides"),
			guides.map(({ slug, title, excerpt }) => link(title, `${SITE_URL}/${locale}/learn/${slug}`, excerpt)),
		],
		[
			t("llms.sections.more"),
			[
				link(t("llms.links.docs"), `https://docs.wonder.money/${docsLang}/docs`, t("llms.links.docsDescription")),
				link(t("llms.links.selfHosting"), selfHostingDocsUrl(locale), t("llms.links.selfHostingDescription")),
				link(t("llms.links.source"), GITHUB_URL, t("llms.links.sourceDescription")),
				...SUPPORTED_LANGS.filter((other) => other !== locale).map((other) =>
					link(`llms.txt (${LANGUAGE_NAMES[other]})`, `${SITE_URL}${llmsTxtPath(other)}`),
				),
			],
		],
	]

	return [
		"# WonderMoney",
		"",
		`> ${oneLine(t("llms.summary"))}`,
		"",
		oneLine(t("llms.about")),
		...sections
			.filter(([, lines]) => lines.length > 0)
			.flatMap(([title, lines]) => ["", `## ${title}`, "", ...lines]),
		"",
	].join("\n")
}

/** The site-wide `/llms.txt`: the English file, as assistants mostly read that one first. */
export const ROOT_LLMS_LOCALE: Lang = "en"
