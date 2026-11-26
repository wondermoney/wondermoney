import { describe, expect, it } from "vitest"
import { HOMEPAGE_FAQ_KEYS, homepageFaq } from "./faq"
import { SUPPORTED_LANGS } from "./routes"
import { APP_STORE_URL, PLAY_STORE_URL } from "./appLinks"
import { buildFaqPageSchema, buildSoftwareApplicationSchema } from "./structuredData"
import { getTranslations } from "./translations"

type Node = Record<string, unknown>
const asPrinted = (node: Node) => JSON.parse(JSON.stringify(node)) as Node

describe("home page FAQ", () => {
	it("asks what people ask assistants: free, safe, banks, self-hosting, the app, the comparison", () => {
		const en = homepageFaq("en").map(({ question }) => question)
		expect(en).toEqual([
			"Is WonderMoney free?",
			"Is my financial data secure?",
			"Which banks are supported?",
			"Can I run WonderMoney on my own server?",
			"Is there a mobile app?",
			"How does WonderMoney compare to a spreadsheet or YNAB?",
			"Can I track investments too?",
		])
	})

	describe.each(SUPPORTED_LANGS)("%s", (locale) => {
		const entries = homepageFaq(locale)

		it("has every question and answer, each its own text", () => {
			expect(entries).toHaveLength(HOMEPAGE_FAQ_KEYS.length)
			for (const { question, answer } of entries) {
				expect(question.trim()).not.toBe("")
				expect(answer.trim()).not.toBe("")
			}
			expect(new Set(entries.map(({ question }) => question)).size).toBe(entries.length)
		})

		it("states the same questions and answers as FAQPage JSON-LD", () => {
			const schema = asPrinted(buildFaqPageSchema(entries)) as {
				"@context": string
				"@type": string
				mainEntity: Array<{ "@type": string; name: string; acceptedAnswer: { "@type": string; text: string } }>
			}
			expect(schema["@context"]).toBe("https://schema.org")
			expect(schema["@type"]).toBe("FAQPage")
			expect(schema.mainEntity).toEqual(
				entries.map(({ question, answer }) => ({
					"@type": "Question",
					name: question,
					acceptedAnswer: { "@type": "Answer", text: answer },
				})),
			)
		})

		it("links the app stores from the app question, as the SoftwareApplication names them", () => {
			const app = entries[HOMEPAGE_FAQ_KEYS.indexOf("faq7")]
			const t = getTranslations(locale)
			expect(app?.links).toEqual([
				{ label: t("homepage.faq.faq7.appStore"), href: APP_STORE_URL },
				{ label: t("homepage.faq.faq7.googlePlay"), href: PLAY_STORE_URL },
			])

			const software = asPrinted(buildSoftwareApplicationSchema(locale))
			expect(software).toMatchObject({
				"@type": "SoftwareApplication",
				name: "WonderMoney",
				operatingSystem: "Web, iOS, Android",
				isAccessibleForFree: true,
				offers: { "@type": "Offer", price: "0", priceCurrency: "EUR" },
				downloadUrl: app?.links?.map(({ href }) => href),
			})
			// Nothing the page does not show: no ratings or reviews.
			expect(software).not.toHaveProperty("aggregateRating")
			expect(software).not.toHaveProperty("review")
		})
	})
})
