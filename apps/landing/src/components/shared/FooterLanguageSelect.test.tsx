// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { SUPPORTED_LANGS } from "@/lib/routes";
import { getTranslations } from "@/lib/translations";
import Footer from "./Footer";

afterEach(cleanup);

describe("footer language select", () => {
  it.each(SUPPORTED_LANGS)(
    "draws its own chevron inside the control, at the text's inset (%s)",
    (locale) => {
      // Given
      render(<Footer locale={locale} />);

      // When
      const select = screen.getByLabelText(getTranslations(locale)("footer.language"));
      const chevron = select.parentElement?.querySelector("svg");
      const selectClasses = select.className.split(/\s+/);
      const chevronClasses = chevron?.getAttribute("class")?.split(/\s+/) ?? [];

      // Then: the native arrow is replaced, and the text stops short of the chevron
      expect(selectClasses).toContain("appearance-none");
      expect(selectClasses).toContain("pl-3");
      expect(selectClasses).toContain("pr-9");
      // The chevron sits 12px from the right edge, the same inset as the text's 12px on the left
      expect(chevron).not.toBeNull();
      expect(chevron?.getAttribute("aria-hidden")).toBe("true");
      expect(chevronClasses).toContain("absolute");
      expect(chevronClasses).toContain("right-3");
      expect(chevronClasses).toContain("pointer-events-none");
      expect(select.parentElement?.className.split(/\s+/)).toContain("relative");
    },
  );
});
