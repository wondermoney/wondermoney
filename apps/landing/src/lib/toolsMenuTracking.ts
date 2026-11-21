import { getPageType } from "./gtm"
import { toolAnalyticsName, type ToolCatalogEntry } from "./toolsCatalog"

/** The header menu a tool link sits in: Tools, or Comparators for the pages comparing offers. */
export type ToolsNavMenu = "tools" | "comparators"

/**
 * The event a click on a tool in the header's Tools or Comparators menu (desktop panel or
 * mobile drawer) sends: `nav_click` with the tool's analytics name, the one the hub's
 * `tool_hub_click` and the tool's own `tool_used` carry, its task group, where the menu was
 * (`header` for the desktop panel, `drawer` for the mobile drawer) and which menu it was
 * (`nav_menu`). Send it through `pushGtmEvent`, which drops it without analytics consent.
 */
export function toolsMenuClickEvent(
	tool: Pick<ToolCatalogEntry, "key" | "group">,
	navPosition: "header" | "drawer",
	navMenu: ToolsNavMenu = "tools",
) {
	return {
		event: "nav_click",
		tool: toolAnalyticsName(tool.key),
		group: tool.group,
		nav_position: navPosition,
		nav_menu: navMenu,
		page_type: getPageType(),
	}
}
