import { afterEach, describe, expect, it, vi } from "vitest"

const pushGtmEvent = vi.fn()

vi.mock("./gtm", () => ({
	getPageType: () => "tools",
	pushGtmEvent: (payload: unknown) => pushGtmEvent(payload),
}))

const { TOOLS_HUB_LINK_ATTRIBUTE, trackToolsHubClicks } = await import("./toolsHubTracking")

afterEach(() => {
	pushGtmEvent.mockReset()
})

function clickOn(target: unknown) {
	let listener: ((event: { target: unknown }) => void) | undefined
	trackToolsHubClicks({ addEventListener: (_type, handler) => (listener = handler) })
	listener?.({ target })
}

// A clicked element inside a link that carries the given data attributes.
function insideLink(dataset: Record<string, string>) {
	return {
		closest: (selector: string) => (selector === `[${TOOLS_HUB_LINK_ATTRIBUTE}]` ? { dataset } : null),
	}
}

describe("tools hub click tracking", () => {
	it("counts a tool card click with the tool, its group and its position", () => {
		clickOn(insideLink({ toolsHubLink: "tool", tool: "household_budget", group: "budgetAndSave", position: "1" }))

		expect(pushGtmEvent).toHaveBeenCalledWith({
			event: "tool_hub_click",
			tool: "household_budget",
			tool_group: "budgetAndSave",
			position: 1,
			page_type: "tools",
		})
	})

	it("counts a task link click with the group it jumps to", () => {
		clickOn(insideLink({ toolsHubLink: "task", group: "investAndGrow" }))

		expect(pushGtmEvent).toHaveBeenCalledWith({
			event: "tool_hub_task_click",
			tool_group: "investAndGrow",
			page_type: "tools",
		})
	})

	it("ignores clicks outside the hub's links", () => {
		clickOn({ closest: () => null })
		clickOn(null)
		clickOn({})

		expect(pushGtmEvent).not.toHaveBeenCalled()
	})
})
