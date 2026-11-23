// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import BrandLogo from "./BrandLogo";

afterEach(cleanup);

it("shows a known brand's logo as a decorative image", () => {
  const { container } = render(<BrandLogo name="Activo Bank" />);
  const tile = container.firstElementChild as HTMLElement;
  expect(tile.getAttribute("aria-hidden")).toBe("true");
  const img = tile.querySelector("img");
  expect(img?.getAttribute("alt")).toBe("");
  expect(img?.getAttribute("src")).toContain("/brands/banks/activobank.webp");
  expect(tile.textContent).toBe("");
});

it("shows initials on a tile for a brand without a logo", () => {
  const { container } = render(<BrandLogo name="Easisave" />);
  const tile = container.firstElementChild as HTMLElement;
  expect(tile.getAttribute("aria-hidden")).toBe("true");
  expect(tile.querySelector("img")).toBeNull();
  expect(tile.textContent).toBe("EA");
});
