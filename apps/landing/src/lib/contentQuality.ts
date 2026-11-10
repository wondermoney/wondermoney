type QualityResult = {
	isPublishable: boolean
	issues: string[]
}

export const CONTENT_QUALITY_ISSUE_KEYS = {
	guide: {
		requiresFormulaOrWorkedExample: "guide.requiresFormulaOrWorkedExample",
		requiresTableOrChart: "guide.requiresTableOrChart",
		requiresTwoReferences: "guide.requiresTwoReferences",
	},
	glossary: {
		requiresPlainDefinition: "glossary.requiresPlainDefinition",
		requiresTechnicalDefinition: "glossary.requiresTechnicalDefinition",
		requiresExample: "glossary.requiresExample",
		requiresRelatedGuide: "glossary.requiresRelatedGuide",
		requiresReference: "glossary.requiresReference",
	},
	monthly: {
		requiresMethodology: "monthly.requiresMethodology",
		requiresDataSource: "monthly.requiresDataSource",
		requiresDelta: "monthly.requiresDelta",
	},
} as const

type GuideQualityInput = {
	sections?: ReadonlyArray<{ _type?: string }>
	references?: ReadonlyArray<unknown>
}

type GlossaryQualityInput = {
	plainDefinition?: string
	technicalDefinition?: string
	miniExample?: string
	references?: ReadonlyArray<unknown>
	relatedGuide?: { _ref?: string } | null
}

type MonthlyQualityInput = {
	methodology?: string
	dataSources?: ReadonlyArray<unknown>
	changeVsPrevious?: ReadonlyArray<unknown>
}

export function validateGuideQuality(input: GuideQualityInput): QualityResult {
	const issues: string[] = []
	const sectionTypes = new Set((input.sections ?? []).map((section) => section._type))
	const references = input.references ?? []

	if (!sectionTypes.has("formula") && !sectionTypes.has("workedExample")) {
		issues.push(CONTENT_QUALITY_ISSUE_KEYS.guide.requiresFormulaOrWorkedExample)
	}

	if (!sectionTypes.has("table") && !sectionTypes.has("chart")) {
		issues.push(CONTENT_QUALITY_ISSUE_KEYS.guide.requiresTableOrChart)
	}

	if (references.length < 2) {
		issues.push(CONTENT_QUALITY_ISSUE_KEYS.guide.requiresTwoReferences)
	}

	return {
		isPublishable: issues.length === 0,
		issues,
	}
}

export function validateGlossaryQuality(input: GlossaryQualityInput): QualityResult {
	const issues: string[] = []
	const plainDefinition = input.plainDefinition?.trim() ?? ""
	const technicalDefinition = input.technicalDefinition?.trim() ?? ""
	const miniExample = input.miniExample?.trim() ?? ""
	const references = input.references ?? []
	const relatedGuideRef = input.relatedGuide?._ref?.trim() ?? ""

	if (plainDefinition.length === 0) {
		issues.push(CONTENT_QUALITY_ISSUE_KEYS.glossary.requiresPlainDefinition)
	}

	if (technicalDefinition.length === 0) {
		issues.push(CONTENT_QUALITY_ISSUE_KEYS.glossary.requiresTechnicalDefinition)
	}

	if (miniExample.length === 0) {
		issues.push(CONTENT_QUALITY_ISSUE_KEYS.glossary.requiresExample)
	}

	if (relatedGuideRef.length === 0) {
		issues.push(CONTENT_QUALITY_ISSUE_KEYS.glossary.requiresRelatedGuide)
	}

	if (references.length < 1) {
		issues.push(CONTENT_QUALITY_ISSUE_KEYS.glossary.requiresReference)
	}

	return {
		isPublishable: issues.length === 0,
		issues,
	}
}

export function validateMonthlyQuality(input: MonthlyQualityInput): QualityResult {
	const issues: string[] = []
	const methodology = input.methodology?.trim() ?? ""
	const dataSources = input.dataSources ?? []
	const changeVsPrevious = input.changeVsPrevious ?? []

	if (methodology.length === 0) {
		issues.push(CONTENT_QUALITY_ISSUE_KEYS.monthly.requiresMethodology)
	}

	if (dataSources.length < 1) {
		issues.push(CONTENT_QUALITY_ISSUE_KEYS.monthly.requiresDataSource)
	}

	if (changeVsPrevious.length < 1) {
		issues.push(CONTENT_QUALITY_ISSUE_KEYS.monthly.requiresDelta)
	}

	return {
		isPublishable: issues.length === 0,
		issues,
	}
}

export type {
	GlossaryQualityInput,
	GuideQualityInput,
	MonthlyQualityInput,
	QualityResult,
}
