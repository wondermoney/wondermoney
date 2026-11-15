import { getPageType, pushGtmEvent } from "./gtm"

/** Marks a link on the tools hub whose clicks are counted: a tool card or a task link. */
export const TOOLS_HUB_LINK_ATTRIBUTE = "data-tools-hub-link"

type LinkData = {
	toolsHubLink?: string
	tool?: string
	group?: string
	position?: string
}

type ClickTarget = { closest?: (selector: string) => { dataset: LinkData } | null } | null

/**
 * The event a click on a tools hub link sends: `tool_hub_click` for a tool card, with the tool's
 * analytics name (the one its `tool_used` event carries), its group and its position on the hub;
 * `tool_hub_task_click` for a task link at the top, with the group it jumps to.
 */
export function toolsHubClickEvent(link: { dataset: LinkData }) {
	const { toolsHubLink, tool, group, position } = link.dataset

	if (toolsHubLink === "tool" && tool) {
		return {
			event: "tool_hub_click",
			tool,
			tool_group: group,
			position: Number(position),
			page_type: getPageType(),
		}
	}

	if (toolsHubLink === "task" && group) {
		return { event: "tool_hub_task_click", tool_group: group, page_type: getPageType() }
	}

	return undefined
}

/** Counts clicks on the hub's marked links, through the consent-gated GTM and PostHog push. */
export function trackToolsHubClicks(root: {
	addEventListener: (type: "click", listener: (event: { target: unknown }) => void) => void
}): void {
	root.addEventListener("click", (event) => {
		const link = (event.target as ClickTarget)?.closest?.(`[${TOOLS_HUB_LINK_ATTRIBUTE}]`)
		const payload = link ? toolsHubClickEvent(link) : undefined

		if (payload) pushGtmEvent(payload)
	})
}
