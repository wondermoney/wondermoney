import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("consent corner-card layout contract", () => {
  it("renders the consent banner as a fixed corner card, not a layout-reserving element", () => {
    // Given
    const layout = readFileSync("src/layouts/Layout.astro", "utf8");
    const banner = readFileSync(
      "src/components/shared/ConsentBanner.tsx",
      "utf8",
    );

    // When
    const consentPosition = layout.indexOf("<ConsentBanner");
    const contentPosition = layout.indexOf("<slot />");
    const surfaceClass = banner.match(
      /<aside\s+className=\{`([^`]*)`\}/,
    )?.[1];

    // Then
    expect(consentPosition).toBeGreaterThan(-1);
    expect(contentPosition).toBeLessThan(consentPosition);
    expect(layout).not.toContain('class="flex h-dvh flex-col"');
    expect(layout).not.toContain("overflow-y-auto");
    expect(surfaceClass?.split(/\s+/)).toContain("fixed");
    expect(surfaceClass).toContain("right-4");
    expect(surfaceClass).toContain("bottom-");
    expect(surfaceClass).not.toContain("w-full");
  });

  it("keeps Back as the first reachable control after focusing the customize heading", () => {
    // Given
    const banner = readFileSync(
      "src/components/shared/ConsentBanner.tsx",
      "utf8",
    );

    // When
    const headingPosition = banner.indexOf("ref={headingRef}");
    const backPosition = banner.indexOf("onClick={returnToDefault}");

    // Then
    expect(headingPosition).toBeGreaterThan(-1);
    expect(headingPosition).toBeLessThan(backPosition);
  });

  it("uses contrast-safe semantic text for the inline failure alert", () => {
    // Given
    const banner = readFileSync(
      "src/components/shared/ConsentBanner.tsx",
      "utf8",
    );

    // When
    const failureClass = banner.match(
      /<p[\s\S]*?role="alert"[\s\S]*?className="([^"]+)"/,
    )?.[1];

    // Then
    expect(failureClass).toContain("text-foreground");
    expect(failureClass).not.toContain("text-destructive");
  });

  it("keeps saved and collapsed states as fixed corner elements", () => {
    // Given
    const status = readFileSync(
      "src/components/shared/ConsentBannerStatus.tsx",
      "utf8",
    );

    // When
    const positionedClasses = [
      ...status.matchAll(/className="([^"]+)"/g),
    ]
      .map((match) => match[1] ?? "")
      .filter((className) => className.includes("fixed"));

    // Then
    expect(positionedClasses).toHaveLength(2);
    for (const className of positionedClasses) {
      expect(className.split(/\s+/)).toContain("fixed");
      expect(className).toContain("right-4");
      expect(className).not.toContain("w-full");
    }
  });
});
