import { describe, expect, it } from "vitest"
import {
	CONTENT_QUALITY_ISSUE_KEYS,
	validateGlossaryQuality,
	validateGuideQuality,
	validateMonthlyQuality,
} from "./contentQuality"

describe("validateGuideQuality", () => {
	it("flags thin guide content with required quality issues", () => {
		const result = validateGuideQuality({
			sections: [{ _type: "concept" }],
			references: [],
		})

		expect(result.isPublishable).toBe(false)
		expect(result.issues).toContain(CONTENT_QUALITY_ISSUE_KEYS.guide.requiresFormulaOrWorkedExample)
		expect(result.issues).toContain(CONTENT_QUALITY_ISSUE_KEYS.guide.requiresTableOrChart)
		expect(result.issues).toContain(CONTENT_QUALITY_ISSUE_KEYS.guide.requiresTwoReferences)
	})

	it("accepts a guide that meets all quality gates", () => {
		const result = validateGuideQuality({
			sections: [{ _type: "concept" }, { _type: "formula" }, { _type: "table" }],
			references: [{ title: "ECB" }, { title: "Eurostat" }],
		})

		expect(result.isPublishable).toBe(true)
		expect(result.issues).toEqual([])
	})

	it("accepts a rich structured guide with worked example and chart", () => {
		const result = validateGuideQuality({
			sections: [
				{ _type: "concept" },
				{ _type: "workedExample" },
				{ _type: "chart" },
			],
			references: [{ title: "Banco de Portugal" }, { title: "OECD" }],
		})

		expect(result.isPublishable).toBe(true)
		expect(result.issues).toEqual([])
	})
})

describe("validateGlossaryQuality", () => {
	it("flags a glossary entry missing required structured fields", () => {
		const result = validateGlossaryQuality({
			plainDefinition: "Simple",
		})

		expect(result.isPublishable).toBe(false)
		expect(result.issues).toContain(CONTENT_QUALITY_ISSUE_KEYS.glossary.requiresTechnicalDefinition)
		expect(result.issues).toContain(CONTENT_QUALITY_ISSUE_KEYS.glossary.requiresExample)
		expect(result.issues).toContain(CONTENT_QUALITY_ISSUE_KEYS.glossary.requiresRelatedGuide)
		expect(result.issues).toContain(CONTENT_QUALITY_ISSUE_KEYS.glossary.requiresReference)
	})

	it("flags missing related guide ref when object is empty", () => {
		const result = validateGlossaryQuality({
			plainDefinition: "Simple",
			technicalDefinition: "Technical",
			miniExample: "100 * 1.05",
			references: [{ title: "source" }],
			relatedGuide: {},
		})

		expect(result.isPublishable).toBe(false)
		expect(result.issues).toContain(CONTENT_QUALITY_ISSUE_KEYS.glossary.requiresRelatedGuide)
	})

	it("flags missing related guide ref when ref is empty", () => {
		const result = validateGlossaryQuality({
			plainDefinition: "Simple",
			technicalDefinition: "Technical",
			miniExample: "100 * 1.05",
			references: [{ title: "source" }],
			relatedGuide: { _ref: "" },
		})

		expect(result.isPublishable).toBe(false)
		expect(result.issues).toContain(CONTENT_QUALITY_ISSUE_KEYS.glossary.requiresRelatedGuide)
	})

	it("flags missing technical definition even when all other fields are present", () => {
		const result = validateGlossaryQuality({
			plainDefinition: "Simple",
			technicalDefinition: "   ",
			miniExample: "100 * 1.05",
			references: [{ title: "source" }],
			relatedGuide: { _ref: "guide-id" },
		})

		expect(result.isPublishable).toBe(false)
		expect(result.issues).toEqual([
			CONTENT_QUALITY_ISSUE_KEYS.glossary.requiresTechnicalDefinition,
		])
	})

	it("accepts a glossary entry with all required structured fields", () => {
		const result = validateGlossaryQuality({
			plainDefinition: "Simple",
			technicalDefinition: "More precise explanation",
			miniExample: "100 * 1.05",
			references: [{ title: "source" }],
			relatedGuide: { _ref: "guide-id" },
		})

		expect(result.isPublishable).toBe(true)
		expect(result.issues).toEqual([])
	})
})

describe("validateMonthlyQuality", () => {
	it("flags a monthly update missing methodology", () => {
		const result = validateMonthlyQuality({
			dataSources: [{ title: "ECB" }],
			changeVsPrevious: [{ metric: "rate", delta: -0.2 }],
		})

		expect(result.isPublishable).toBe(false)
		expect(result.issues).toContain(CONTENT_QUALITY_ISSUE_KEYS.monthly.requiresMethodology)
	})

	it("flags missing data source and delta", () => {
		const result = validateMonthlyQuality({
			methodology: "Method notes",
		})

		expect(result.isPublishable).toBe(false)
		expect(result.issues).toContain(CONTENT_QUALITY_ISSUE_KEYS.monthly.requiresDataSource)
		expect(result.issues).toContain(CONTENT_QUALITY_ISSUE_KEYS.monthly.requiresDelta)
	})

	it("accepts a monthly update with required structured fields", () => {
		const result = validateMonthlyQuality({
			methodology: "Method notes",
			dataSources: [{ title: "ECB" }],
			changeVsPrevious: [{ metric: "rate", delta: -0.2 }],
		})

		expect(result.isPublishable).toBe(true)
		expect(result.issues).toEqual([])
	})
})
