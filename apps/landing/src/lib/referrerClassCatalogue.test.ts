import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { REFERRER_CLASSES } from "./referrerClass"

describe("referrer classes", () => {
	it("are the analytics catalogue's ANALYTICS_REFERRER_CLASSES, in order", () => {
		// The website does not depend on the shared package: read its list from the source.
		const catalogue = readFileSync(new URL("../../../../packages/shared/lib/analytics/catalogue.ts", import.meta.url), "utf8")
		const list = catalogue.match(/ANALYTICS_REFERRER_CLASSES = \[([^\]]*)\]/u)?.[1] ?? ""

		expect([...list.matchAll(/'([a-z_]+)'/gu)].map(([, value]) => value)).toEqual([...REFERRER_CLASSES])
	})
})
