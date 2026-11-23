import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { OG_IMAGE_HEIGHT, OG_IMAGE_WIDTH, featureOgCard, guideOgCard, toolOgCard, toolsHubOgCard } from "./ogImages"
import { renderOgImage, wrapText } from "./renderOgImage"

/** Width and height from a PNG's IHDR chunk. */
function pngSize(bytes: Buffer): { width: number; height: number } {
	expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a")
	return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
}

// One character, one unit: easy widths to reason about.
const measure = (text: string) => text.length

describe("wrapText", () => {
	it("breaks between words at the width", () => {
		expect(wrapText(measure, "aaa bbb ccc", 7)).toEqual({ lines: ["aaa bbb", "ccc"], overflowed: false })
	})

	it("keeps a word longer than the width on a line of its own", () => {
		expect(wrapText(measure, "abcdefghij k", 5).lines).toEqual(["abcdefghij", "k"])
	})

	it("cuts to the line limit and ends the last line with an ellipsis", () => {
		const { lines, overflowed } = wrapText(measure, "one two three four five six", 9, 2)
		expect(overflowed).toBe(true)
		expect(lines).toHaveLength(2)
		expect(lines[1].endsWith("…")).toBe(true)
		expect(measure(lines[1])).toBeLessThanOrEqual(9)
	})
})

describe("renderOgImage", () => {
	it("draws a 1200×630 PNG for a tool, the hub, a feature and a guide", async () => {
		const cards = [
			toolOgCard("toolMortgageTransfer", "pt"),
			toolOgCard("toolFuelPrices", "de"),
			toolsHubOgCard("fr"),
			featureOgCard("featureSelfHosting", "es"),
			guideOgCard({ locale: "en", slug: "sample", title: "A guide", excerpt: "What it covers." }),
		]
		const outDir = process.env.OG_SAMPLES_DIR

		for (const card of cards) {
			const png = await renderOgImage(card)
			expect(pngSize(png)).toEqual({ width: OG_IMAGE_WIDTH, height: OG_IMAGE_HEIGHT })
			// Set OG_SAMPLES_DIR to look at the images.
			if (outDir) {
				mkdirSync(outDir, { recursive: true })
				writeFileSync(join(outDir, `${card.pagePath.replaceAll("/", "_")}.png`), png)
			}
		}
	})
})
