import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL("../../", import.meta.url));
const COMPONENT = "components/ui/select.tsx";

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(tsx|jsx|astro|mdx)$/.test(entry.name) && !/\.test\./.test(entry.name) ? [path] : [];
  });
}

describe("dropdowns", () => {
  it("render through the shared Select, never a raw <select>", () => {
    // Given every component, page and layout under src
    const files = sourceFiles(SRC).map((file) => relative(SRC, file).split(sep).join("/"));

    // When we look for a native select element outside the shared component
    const offenders = files
      .filter((file) => file !== COMPONENT)
      .filter((file) => /<select[\s>]/.test(readFileSync(join(SRC, file), "utf8")));

    // Then there is none: the native arrow sits flush with the border, so every dropdown
    // uses components/ui/select.tsx, which draws its own chevron at the text's inset
    expect(files).toContain(COMPONENT);
    expect(offenders).toEqual([]);
  });
});
