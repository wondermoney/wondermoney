import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL("../../", import.meta.url));
const COMPONENT = "components/ui/input.tsx";

/** Input types that are not a text field and keep their own controls: out of the component's scope. */
const NON_TEXT_TYPES = new Set(["checkbox", "radio", "file", "range", "hidden", "submit", "button", "reset", "color", "image"]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(tsx|jsx|astro|mdx)$/.test(entry.name) && !/\.test\./.test(entry.name) ? [path] : [];
  });
}

/**
 * Every native `<input>` in `source` that would draw a text field: one whose `type` is missing
 * (the browser's default is text), set from an expression, or a text-like literal, with the
 * line it starts on. A tag ends at its self-closing `/>` or at the next element.
 */
function rawTextInputs(source: string): { line: number; tag: string }[] {
  return [...source.matchAll(/<input(?=[\s/>])/g)].flatMap((match) => {
    const rest = source.slice(match.index);
    const end = Math.min(...[rest.indexOf("/>"), rest.indexOf("<", 1)].filter((index) => index >= 0), rest.length);
    const tag = rest.slice(0, end);
    const type = /\stype=(?:"([^"]*)"|'([^']*)'|\{\s*["']([^"']*)["']\s*\})/.exec(tag);
    const literal = type?.[1] ?? type?.[2] ?? type?.[3];
    if (literal !== undefined && NON_TEXT_TYPES.has(literal.toLowerCase())) return [];
    const line = source.slice(0, match.index).split("\n").length;
    return [{ line, tag: tag.replace(/\s+/g, " ").trim() }];
  });
}

describe("text fields", () => {
  it("render through the shared Input, never a raw text, number or date <input>", () => {
    // Given every component, page and layout under src
    const files = sourceFiles(SRC).map((file) => relative(SRC, file).split(sep).join("/"));

    // When we look for a native text-like input outside the shared component
    const offenders = files
      .filter((file) => file !== COMPONENT)
      .flatMap((file) =>
        rawTextInputs(readFileSync(join(SRC, file), "utf8")).map(({ line, tag }) => `${file}:${line} ${tag.slice(0, 80)}`),
      );

    // Then there is none: every field uses components/ui/input.tsx, which draws the select's
    // box, focus ring and error border
    expect(files).toContain(COMPONENT);
    expect(offenders).toEqual([]);
  });

  it("flags text, number, date and untyped inputs and leaves checkboxes, radios, files and ranges alone", () => {
    // Given
    const source = `
      <input type="text" value={a} />
      <input
        id="amount"
        type="number"
        onChange={(event) => set(event.currentTarget.value)}
      />
      <input type={"date"} />
      <input value={b} />
      <input type="checkbox" checked={c} onChange={() => toggle()} />
      <input type="radio" name="mode" />
      <input type="file" accept=".pdf" />
      <input type="range" min={0} />
      <Input type="text" />
    `;

    // When
    const found = rawTextInputs(source);

    // Then
    expect(found.map(({ line }) => line)).toEqual([2, 3, 8, 9]);
    expect(found.map(({ tag }) => tag)).toEqual([
      '<input type="text" value={a}',
      '<input id="amount" type="number" onChange={(event) => set(event.currentTarget.value)}',
      '<input type={"date"}',
      "<input value={b}",
    ]);
  });
});
