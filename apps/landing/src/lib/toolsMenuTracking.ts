import { getPageType } from "./gtm"
import { toolAnalyticsName, type ToolCatalogEntry } from "./toolsCatalog"

/**
 * The event a click on a tool in the header's Tools menu (desktop panel or mobile drawer) sends:
 * `nav_click` with the tool's analytics name, the one the hub's `tool_hub_click` and the tool's
 * own `tool_used` carry, its task group, and where the menu was: `header` for the desktop panel,
 * `drawer` for the mobile drawer. Send it through `pushGtmEvent`, which drops it without
 * analytics consent.
 */
export function toolsMenuClickEvent(
	tool: Pick<ToolCatalogEntry, "key" | "group">,
	navPosition: "header" | "drawer",
) {
	return {
		event: "nav_click",
		tool: toolAnalyticsName(tool.key),
		group: tool.group,
		nav_position: navPosition,
		page_type: getPageType(),
	}
}
