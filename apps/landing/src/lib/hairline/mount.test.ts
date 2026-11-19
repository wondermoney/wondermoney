// @vitest-environment jsdom

import { beforeAll, describe, expect, it } from "vitest";
import { loadFigure, mountFigure } from "./mount";

beforeAll(() => {
  // jsdom has neither; the kernel's frame loop needs both.
  globalThis.IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof IntersectionObserver;
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
});

describe("hairline mount", () => {
  it("loads a figure written in the skill's format through the HL and hairline globals", async () => {
    const jar = await loadFigure("jar");
    expect(jar.name).toBe("jar");
    expect(jar.range).toHaveLength(3);
    expect(typeof (globalThis as { HL?: unknown }).HL).toBe("object");
  });

  it("draws into the box it is given and keeps the read-out off the page", async () => {
    const box = document.createElement("div");
    box.dataset.hlFigure = "jar";
    box.setAttribute("role", "img");
    box.setAttribute("aria-label", "A savings jar");
    document.body.append(box);

    const handle = await mountFigure(box);

    expect(handle).not.toBeNull();
    expect(box.dataset.hairline).toBe("jar");
    expect(box.getAttribute("aria-label")).toBe("A savings jar");
    const svg = box.querySelector("svg");
    expect(svg?.getAttribute("viewBox")).toBe("0 0 400 320");
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
    expect(svg?.querySelectorAll("path").length).toBeGreaterThan(10);
    expect(box.textContent).toBe("");
    // The kernel's stylesheet: adopted where the DOM supports it, a <style> element otherwise.
    const adopted = (document as Document & { adoptedStyleSheets?: CSSStyleSheet[] }).adoptedStyleSheets ?? [];
    expect(adopted.length > 0 || document.querySelector("style[data-hairline-style]") !== null).toBe(true);

    // A second pass over the same box draws nothing twice.
    expect(await mountFigure(box)).toBeNull();
    expect(box.querySelectorAll("svg")).toHaveLength(1);
    handle?.destroy();
  });

  it("refuses a figure that has no file", async () => {
    await expect(loadFigure("nope")).rejects.toThrow('no figure named "nope"');
  });
});
