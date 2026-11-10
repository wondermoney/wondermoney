export type PortableTextBlock = Readonly<{
	_type: string
}> & Readonly<Record<string, unknown>>

type GuideSectionBase<TType extends string> = {
	_type: TType
	title?: string
}

export type GuideConceptSection = GuideSectionBase<"concept"> & {
	body?: ReadonlyArray<PortableTextBlock>
}

export type GuideFormulaSection = GuideSectionBase<"formula"> & {
	expression?: string
	variables?: ReadonlyArray<Readonly<{ symbol: string; meaning: string }>>
}

export type GuideWorkedExampleSection = GuideSectionBase<"workedExample"> & {
	steps?: ReadonlyArray<string>
	result?: string
}

export type GuideTableSection = GuideSectionBase<"table"> & {
	columns?: ReadonlyArray<string>
	rows?: ReadonlyArray<ReadonlyArray<string>>
}

export type GuideChartSection = GuideSectionBase<"chart"> & {
	chartType?: "line" | "bar"
	series?: ReadonlyArray<Readonly<{ label: string; values: ReadonlyArray<number> }>>
}

export type GuideFaqSection = GuideSectionBase<"faq"> & {
	items?: ReadonlyArray<Readonly<{ question: string; answer: string }>>
}

export type GuideReferenceListSection = GuideSectionBase<"referenceList">

export type GuideWarningSection = GuideSectionBase<"warning"> & {
	body?: string
}

export type GuideSection =
	| GuideConceptSection
	| GuideFormulaSection
	| GuideWorkedExampleSection
	| GuideTableSection
	| GuideChartSection
	| GuideFaqSection
	| GuideReferenceListSection
	| GuideWarningSection

type NormalizeGuideSectionsInput = {
	sections?: ReadonlyArray<GuideSection>
	body?: ReadonlyArray<PortableTextBlock>
}

export function normalizeGuideSections(
	input: NormalizeGuideSectionsInput,
): ReadonlyArray<GuideSection> {
	const { sections, body } = input

	if (sections && sections.length > 0) {
		return sections
	}

	if (body && body.length > 0) {
		return [
			{
				_type: "concept",
				title: "Overview",
				body,
			},
		]
	}

	return []
}
