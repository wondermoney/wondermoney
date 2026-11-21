import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { guideFigureFaces } from "./guideBlocks"

describe("guide figure faces", () => {
	it("sets figures in the financial face", () => {
		expect(guideFigureFaces({ label: "Ratio", value: "29,8%", detail: "850 € ÷ 2850 €", share: 29.8, shareLabel: "29,8%" })).toEqual({
			value: "font-mono",
			detail: "font-mono",
			shareLabel: "font-mono",
		})
		expect(guideFigureFaces({ label: "Months to target", value: "24 meses" }).value).toBe("font-mono")
	})

	it("sets each part flagged as words in the body face", () => {
		expect(guideFigureFaces({ label: "Time saved", value: "4 anos e 10 meses", text: true })).toEqual({
			value: "font-sans",
			detail: "font-mono",
			shareLabel: "font-mono",
		})
		expect(
			guideFigureFaces({ label: "Ratio", value: "29,8%", detail: "Atenção", detailText: true, share: 29.8, shareLabel: "Atenção", shareLabelText: true }),
		).toEqual({ value: "font-mono", detail: "font-sans", shareLabel: "font-sans" })
	})
})

describe("GuideFigures.astro", () => {
	it("takes every typeface from guideFigureFaces", () => {
		const source = readFileSync(new URL("./GuideFigures.astro", import.meta.url), "utf8")
		expect(source).toContain("guideFigureFaces(figure)")
		expect(source).not.toMatch(/font-(mono|sans)/)
	})
})
