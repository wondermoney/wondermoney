// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { SUPPORTED_LANGS } from "@/lib/i18nLocale";
import { getTranslations } from "@/lib/translations";
import ContentSearch from "./ContentSearch";

afterEach(cleanup);

const items = [{ title: "Emergency fund", href: "/en/learn/emergency-fund" }];

describe("ContentSearch", () => {
  it.each(SUPPORTED_LANGS)("names the field in %s, apart from its placeholder", (locale) => {
    // Given
    const t = getTranslations(locale);
    render(<ContentSearch locale={locale} items={items} />);

    // When
    const field = screen.getByRole("searchbox", { name: t("global.search.label") });

    // Then the name is a translated string of its own, not the missing key or the placeholder
    expect(t("global.search.label")).not.toBe("global.search.label");
    expect(field.getAttribute("placeholder")).toBe(t("global.search.placeholder"));
  });

  it.each(SUPPORTED_LANGS)("takes the hub's own name in %s, saying what the field searches", (locale) => {
    // Given the learn and glossary hubs' labels
    const t = getTranslations(locale);
    for (const hub of ["learn", "glossary"] as const) {
      const label = t(`${hub}.hub.searchLabel`);
      expect(label).not.toBe(`${hub}.hub.searchLabel`);

      // When
      render(<ContentSearch locale={locale} items={items} label={label} placeholder={t(`${hub}.hub.searchPlaceholder`)} />);

      // Then
      expect(screen.getByRole("searchbox", { name: label })).toBeTruthy();
      cleanup();
    }
  });

  it("is given its hub's name by the learn and glossary hub pages", () => {
    for (const [page, hub] of [["LearnHubPage", "learn"], ["GlossaryHubPage", "glossary"]] as const) {
      const source = readFileSync(join(import.meta.dirname, `../pages/${page}.astro`), "utf8");
      expect(source).toContain(`label={t("${hub}.hub.searchLabel")}`);
    }
  });
});
