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

type Listener = (event: { target: unknown; button?: number }) => void

function dispatch(type: "click" | "auxclick", target: unknown, button = type === "click" ? 0 : 1) {
	const listeners: Partial<Record<string, Listener>> = {}
	trackToolsHubClicks({ addEventListener: (eventType, handler) => (listeners[eventType] = handler) })
	listeners[type]?.({ target, button })
}

function clickOn(target: unknown) {
	dispatch("click", target)
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

	it("counts a middle-click that opens a tool in a new tab", () => {
		dispatch("auxclick", insideLink({ toolsHubLink: "tool", tool: "fire", group: "investAndGrow", position: "9" }))

		expect(pushGtmEvent).toHaveBeenCalledWith({
			event: "tool_hub_click",
			tool: "fire",
			tool_group: "investAndGrow",
			position: 9,
			page_type: "tools",
		})
	})

	it("ignores other auxiliary buttons, such as a right-click", () => {
		dispatch("auxclick", insideLink({ toolsHubLink: "tool", tool: "fire", group: "investAndGrow", position: "9" }), 2)

		expect(pushGtmEvent).not.toHaveBeenCalled()
	})

	it("ignores clicks outside the hub's links", () => {
		clickOn({ closest: () => null })
		clickOn(null)
		clickOn({})

		expect(pushGtmEvent).not.toHaveBeenCalled()
	})
})
