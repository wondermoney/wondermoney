const OG_LOCALE_BY_LANG = {
	pt: "pt_PT",
	en: "en_GB",
	es: "es_ES",
	fr: "fr_FR",
	de: "de_DE",
	it: "it_IT",
} as const

type OgLocaleLang = keyof typeof OG_LOCALE_BY_LANG

function isOgLocaleLang(value: string): value is OgLocaleLang {
	return value in OG_LOCALE_BY_LANG
}

export function toOgLocale(input?: string): string {
	const normalized = (input ?? "").trim().replace(/_/g, "-").toLowerCase()
	const lang = normalized.split("-")[0]

	if (isOgLocaleLang(lang)) {
		return OG_LOCALE_BY_LANG[lang]
	}

	return OG_LOCALE_BY_LANG.en
}
