import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL("../../", import.meta.url));
const COMPONENT = "components/ui/fieldMessage.tsx";

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(tsx|jsx|astro|mdx)$/.test(entry.name) && !/\.test\./.test(entry.name) ? [path] : [];
  });
}

/** The opening tag that starts at `start`, up to the `>` outside any `{…}` or quoted value. */
function openingTag(source: string, start: number): string {
  let depth = 0;
  let quote: string | undefined;
  for (let index = start + 1; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (char === quote) quote = undefined;
    } else if (char === '"' || char === "'" || char === "`") {
      quote = char;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
    } else if (char === ">" && depth === 0) {
      return source.slice(start, index + 1);
    }
  }
  return source.slice(start);
}

const lineOf = (source: string, index: number) => source.slice(0, index).split("\n").length;

/** The value of attribute `name` in `tag`: a quoted string, or a `{…}` expression with its braces balanced. */
function attribute(tag: string, name: string): string | undefined {
  const match = new RegExp(`\\s${name}=`).exec(tag);
  if (!match) return undefined;
  const start = match.index + match[0].length;
  const open = tag[start];
  if (open === '"' || open === "'") return tag.slice(start + 1, tag.indexOf(open, start + 1));
  if (open !== "{") return undefined;
  let depth = 0;
  for (let index = start; index < tag.length; index += 1) {
    if (tag[index] === "{") depth += 1;
    if (tag[index] === "}" && --depth === 0) return tag.slice(start + 1, index);
  }
  return tag.slice(start + 1);
}

/**
 * Every line under a field drawn outside `FieldMessage`: a raw `<p>` whose `id` names a help or
 * error message or is one a field's `aria-describedby` points at, or an alert set in the
 * destructive colour. A result line in red that no field points at is not one.
 */
function rawFieldMessages(source: string): { line: number; tag: string }[] {
  const describedIds = new Set(
    [...source.matchAll(/aria-describedby="([^"]*)"/g)].flatMap((match) => match[1].split(/\s+/).filter(Boolean)),
  );
  return [...source.matchAll(/<p(?=[\s>])/g)].flatMap((match) => {
    const tag = openingTag(source, match.index);
    const id = attribute(tag, "id") ?? "";
    const classes = attribute(tag, "className") ?? attribute(tag, "class") ?? "";
    const describes = /help|error/i.test(id) || describedIds.has(id);
    const redAlert = attribute(tag, "role") === "alert" && /(?:^|[\s"'`])text-destructive(?:-text)?(?=$|[\s"'`])/.test(classes);
    return describes || redAlert ? [{ line: lineOf(source, match.index), tag: tag.replace(/\s+/g, " ") }] : [];
  });
}

/** Every `<FieldMessage>` whose `className` sets a text size or colour of its own. */
function restyledMessages(source: string): { line: number; classes: string }[] {
  return [...source.matchAll(/<FieldMessage(?=[\s/>])/g)].flatMap((match) => {
    const classes = attribute(openingTag(source, match.index), "className") ?? "";
    return /(?:^|[\s"'`:])text-[\w[\]./-]+/.test(classes) ? [{ line: lineOf(source, match.index), classes }] : [];
  });
}

describe("field messages", () => {
  const files = sourceFiles(SRC).map((file) => relative(SRC, file).split(sep).join("/"));

  it("render through FieldMessage, never a raw help or error <p>", () => {
    // When we look for a help or error line drawn by hand outside the shared component
    const offenders = files
      .filter((file) => file !== COMPONENT)
      .flatMap((file) =>
        rawFieldMessages(readFileSync(join(SRC, file), "utf8")).map(({ line, tag }) => `${file}:${line} ${tag.slice(0, 100)}`),
      );

    // Then there is none: every one is 12px, help muted and errors in destructive-text
    expect(files).toContain(COMPONENT);
    expect(offenders).toEqual([]);
  });

  it("keep the shared size and colour: no FieldMessage sets its own", () => {
    const offenders = files.flatMap((file) =>
      restyledMessages(readFileSync(join(SRC, file), "utf8")).map(({ line, classes }) => `${file}:${line} ${classes}`),
    );
    expect(offenders).toEqual([]);
  });

  it("flags help and error ids and red alerts, and leaves result lines, children and other tags alone", () => {
    // Given
    const source = `
      <p id={\`\${id}-help\`} className="text-xs text-muted-foreground">{help}</p>
      <p role="alert" className="text-sm text-destructive">{err(field)}</p>
      <p className="text-sm text-destructive-text">{t(k("status.feeExceeds"))}</p>
      <p className="text-sm">{t(k("help.power"))}</p>
      <p id="tariff-solar-help"
        className="pl-6 text-xs text-muted-foreground">
        {t(k("solar.help"))}
      </p>
      <path id="error-icon" />
      <FieldMessage id="x-help">{help}</FieldMessage>
      <input aria-describedby="upload-note" type="file" />
      <p id="upload-note">{note}</p>
    `;

    // When
    const found = rawFieldMessages(source);

    // Then
    expect(found.map(({ line }) => line)).toEqual([2, 3, 6, 13]);
  });

  it("flags a FieldMessage that resizes or recolours itself and leaves layout classes alone", () => {
    const source = `
      <FieldMessage className="pl-6">{a}</FieldMessage>
      <FieldMessage tone="error" className="text-xs">{b}</FieldMessage>
      <FieldMessage className={cn("mt-3", warn && "text-warning-text")}>{c}</FieldMessage>
    `;
    expect(restyledMessages(source).map(({ line }) => line)).toEqual([3, 4]);
  });
});
