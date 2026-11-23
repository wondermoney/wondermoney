import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { SUPPORTED_LANGS } from "./routes"

// A tool page's <title> is its `tools.<key>.pageTitle` as written (no brand suffix is added) and
// its meta description is `tools.<key>.pageDescription`. Search results cut a title after about
// 60 characters and a description after about 160, so both stay within those limits.
const MAX_TITLE = 60
const MAX_DESCRIPTION = 160

type Copy = { tools: Record<string, unknown> }

function readLocale(base: "src/locales" | "public/locales", lang: string): Copy {
	return JSON.parse(readFileSync(fileURLToPath(new URL(`../../${base}/${lang}/common.json`, import.meta.url)), "utf8")) as Copy
}

function toolMeta(copy: Copy): Array<{ key: string; pageTitle: string; pageDescription: string }> {
	return Object.entries(copy.tools).flatMap(([key, value]) => {
		if (typeof value !== "object" || value === null) return []
		const { pageTitle, pageDescription } = value as Record<string, unknown>
		if (typeof pageTitle !== "string" || typeof pageDescription !== "string") return []
		return [{ key, pageTitle, pageDescription }]
	})
}

const cases = SUPPORTED_LANGS.flatMap((lang) =>
	(["src/locales", "public/locales"] as const).map((base) => [`${base}/${lang}`, readLocale(base, lang)] as const),
)

describe("tool page titles and descriptions", () => {
	it("reads every tool page in every locale", () => {
		for (const [, copy] of cases) expect(toolMeta(copy).length).toBeGreaterThan(40)
	})

	it.each(cases)(`%s keeps every pageTitle within ${MAX_TITLE} characters`, (_name, copy) => {
		const tooLong = toolMeta(copy)
			.filter(({ pageTitle }) => pageTitle.length > MAX_TITLE)
			.map(({ key, pageTitle }) => `${key} (${pageTitle.length}): ${pageTitle}`)
		expect(tooLong).toEqual([])
	})

	it.each(cases)(`%s keeps every pageDescription within ${MAX_DESCRIPTION} characters`, (_name, copy) => {
		const tooLong = toolMeta(copy)
			.filter(({ pageDescription }) => pageDescription.length > MAX_DESCRIPTION)
			.map(({ key, pageDescription }) => `${key} (${pageDescription.length}): ${pageDescription}`)
		expect(tooLong).toEqual([])
	})
})
