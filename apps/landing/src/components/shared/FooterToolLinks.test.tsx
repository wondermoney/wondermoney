// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { SUPPORTED_LANGS, toLocalizedPath, toToolsHubPath } from "@/lib/routes";
import { TOOLS_CATALOG, TOOL_GROUPS } from "@/lib/toolsCatalog";
import { getTranslations } from "@/lib/translations";
import Footer from "./Footer";

afterEach(cleanup);

const footerTools = TOOLS_CATALOG.filter((tool) => "footer" in tool && tool.footer);

describe("footer tool links", () => {
  it.each(SUPPORTED_LANGS)("links every footer tool of the catalog under its task group (%s)", (locale) => {
    // Given
    const t = getTranslations(locale);

    // When
    const { container } = render(<Footer locale={locale} />);
    const band = container.querySelector("[data-footer-tools]");

    // Then: one column per task group that has footer tools, its heading linking the hub section
    expect(band).not.toBeNull();
    const headings = [...band!.querySelectorAll("h3 a")];
    const groups = TOOL_GROUPS.filter((group) => footerTools.some((tool) => tool.group === group.id));
    expect(headings.map((link) => [link.textContent, link.getAttribute("href")])).toEqual(
      groups.map((group) => [t(`tools.hub.groups.${group.id}.title`), `${toToolsHubPath(locale)}#${group.anchor}`]),
    );

    // and each footer tool by its short name, at its localized address
    const links = [...band!.querySelectorAll("li a")].map((link) => [link.textContent, link.getAttribute("href")]);
    expect(links).toHaveLength(footerTools.length);
    for (const tool of footerTools) {
      expect(links).toContainEqual([t(`tools.${tool.key}.shortName`), toLocalizedPath(tool.routeId, locale)]);
    }
  });

  it("links two to four tools of every task group", () => {
    for (const group of TOOL_GROUPS) {
      const count = footerTools.filter((tool) => tool.group === group.id).length;
      expect(count, group.id).toBeGreaterThanOrEqual(2);
      expect(count, group.id).toBeLessThanOrEqual(4);
    }
  });
});
