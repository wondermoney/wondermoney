import { describe, expect, it } from "vitest"
import { normalizeGuideSections, type GuideSection } from "./learningContent"

describe("normalizeGuideSections", () => {
  it("returns sections when present with items", () => {
    const sections: ReadonlyArray<GuideSection> = [
      {
        _type: "concept",
        title: "Overview",
        body: [{ _type: "block", children: [] }],
      },
    ]

    expect(normalizeGuideSections({ sections })).toEqual(sections)
  })

  it("falls back to a single concept section from legacy body", () => {
    const body = [{ _type: "block", children: [] }]

    expect(normalizeGuideSections({ body })).toEqual([
      {
        _type: "concept",
        title: "Overview",
        body,
      },
    ])
  })

  it("falls back to legacy body when sections is empty", () => {
    const body = [{ _type: "block", children: [] }]

    expect(normalizeGuideSections({ sections: [], body })).toEqual([
      {
        _type: "concept",
        title: "Overview",
        body,
      },
    ])
  })

	it("preserves formula and table variant fields", () => {
    const sections: ReadonlyArray<GuideSection> = [
      {
        _type: "formula",
        title: "Newton's Second Law",
        expression: "F = m * a",
        variables: [
          { symbol: "F", meaning: "Force" },
          { symbol: "m", meaning: "Mass" },
          { symbol: "a", meaning: "Acceleration" },
        ],
      },
      {
        _type: "table",
        title: "Sample Values",
        columns: ["m", "a", "F"],
        rows: [
          ["2", "3", "6"],
          ["5", "4", "20"],
        ],
      },
    ]

		expect(normalizeGuideSections({ sections })).toEqual(sections)
	})

	it("preserves referenceList variant fields", () => {
		const sections: ReadonlyArray<GuideSection> = [
			{
				_type: "referenceList",
				title: "Sources",
			},
		]

		expect(normalizeGuideSections({ sections })).toEqual(sections)
	})

  it("returns an empty array when both sections and body are missing", () => {
    expect(normalizeGuideSections({})).toEqual([])
  })

  it("returns an empty array when sections and body are empty", () => {
    expect(normalizeGuideSections({ sections: [], body: [] })).toEqual([])
  })
})
