import { getPageType } from "./gtm"
import { toolAnalyticsName, type ToolCatalogEntry } from "./toolsCatalog"

/**
 * The event a click on a tool in the header's Tools menu (desktop panel or mobile drawer) sends:
 * `nav_click` with the tool's analytics name, the one the hub's `tool_hub_click` and the tool's
 * own `tool_used` carry, and its task group. Send it through `pushGtmEvent`, which drops it
 * without analytics consent.
 */
export function toolsMenuClickEvent(tool: Pick<ToolCatalogEntry, "key" | "group">) {
	return {
		event: "nav_click",
		tool: toolAnalyticsName(tool.key),
		group: tool.group,
		page_type: getPageType(),
	}
}
