import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseDocument } from "yaml";
import { buildGlossaryTerms, buildGuides, buildMonthlyItems, type ContentEntry } from "@/lib/contentEntries";
import { SUPPORTED_LANGS } from "@/lib/routes";
import {
  CONTENT_DIRECTORIES,
  contentSlug,
  glossaryTermSchema,
  guideSchema,
  monthlySchema,
  type GlossaryTermData,
  type GuideData,
  type MonthlyData,
} from "./schemas";

const contentRoot = fileURLToPath(new URL(".", import.meta.url));

type ParsedFile = { id: string; frontmatter: unknown; body: string };

// Frontmatter parsed as Astro's loader parses it (@astrojs/internal-helpers/yaml).
function parseMarkdown(source: string, file: string): { frontmatter: unknown; body: string } {
  const match = /^---\n([\s\S]*?\n)---\n?([\s\S]*)$/.exec(source);
  if (!match) throw new Error(`${file} does not start with --- frontmatter ---`);
  const document = parseDocument(match[1], { customTags: ["timestamp"], merge: true, schema: "core" });
  if (document.errors.length > 0) throw new Error(`${file}: ${document.errors[0].message}`);
  return { frontmatter: document.toJS(), body: match[2].trim() };
}

function readCollection(directory: string): { files: ParsedFile[]; strays: string[] } {
  const base = join(contentRoot, directory);
  const files: ParsedFile[] = [];
  const strays: string[] = [];
  for (const entry of readdirSync(base, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || entry.name === ".gitkeep") continue;
    const path = relative(base, join(entry.parentPath, entry.name));
    const match = /^([a-z]+)\/(.+)\.md$/.exec(path);
    if (!match || !(SUPPORTED_LANGS as readonly string[]).includes(match[1]) || !contentSlug.safeParse(match[2]).success) {
      strays.push(path);
      continue;
    }
    files.push({ id: `${match[1]}/${match[2]}`, ...parseMarkdown(readFileSync(join(base, path), "utf8"), path) });
  }
  return { files: files.sort((a, b) => a.id.localeCompare(b.id)), strays };
}

function validate<TData>(directory: string, schema: { safeParse: (value: unknown) => { success: boolean; data?: TData; error?: unknown } }) {
  const { files, strays } = readCollection(directory);
  const entries: Array<ContentEntry<TData> & { body: string }> = [];
  const errors: string[] = [];
  for (const file of files) {
    const result = schema.safeParse(file.frontmatter);
    if (result.success) entries.push({ id: file.id, data: result.data as TData, body: file.body });
    else errors.push(`${directory}/${file.id}.md: ${String(result.error)}`);
  }
  return { entries, errors, strays };
}

const guides = validate<GuideData>(CONTENT_DIRECTORIES.guides, guideSchema);
const glossary = validate<GlossaryTermData>(CONTENT_DIRECTORIES.glossary, glossaryTermSchema);
const monthly = validate<MonthlyData>(CONTENT_DIRECTORIES.monthly, monthlySchema);

const collections = { guides, glossary, monthly };
const localeOf = (id: string) => id.split("/")[0];

describe("learn content files", () => {
  it.each(Object.entries(collections))("%s holds only <locale>/<slug>.md files", (_name, collection) => {
    expect(collection.strays).toEqual([]);
  });

  it.each(Object.entries(collections))("every %s entry validates against its schema", (_name, collection) => {
    expect(collection.errors).toEqual([]);
  });

  it("holds the guides and glossary terms the site was built from", () => {
    // 8 guides and 40 terms each in en and pt, exported from the CMS; no monthly items yet.
    expect(guides.entries.length).toBeGreaterThanOrEqual(16);
    expect(glossary.entries.length).toBeGreaterThanOrEqual(80);
  });

  it("gives every guide a body", () => {
    expect(guides.entries.filter((entry) => !entry.body).map((entry) => entry.id)).toEqual([]);
  });

  it("resolves every related term and guide within the same locale", () => {
    expect(() => buildGuides(guides.entries, glossary.entries)).not.toThrow();
    expect(() => buildGlossaryTerms(glossary.entries, guides.entries)).not.toThrow();
    expect(() => buildMonthlyItems(monthly.entries)).not.toThrow();
  });

  it.each(Object.entries(collections))("keeps %s topic keys unique within a locale", (_name, collection) => {
    const keys = collection.entries
      .map((entry) => ("topicKey" in entry.data && entry.data.topicKey ? `${localeOf(entry.id)}::${entry.data.topicKey}` : null))
      .filter((key): key is string => key !== null);
    expect(keys.filter((key, index) => keys.indexOf(key) !== index)).toEqual([]);
  });
});

/**
 * Each locale that has guides or terms has the translation of every document the others have:
 * en and pt carry the same set today. A locale with none (es, fr, de and it) shows the hub's
 * "coming soon" state instead, so it is left out. The documents' slugs differ by language, so
 * a document is matched by what it links to: its category and its calculators.
 */
describe("learn content locale parity", () => {
  const signatures = (entries: ReadonlyArray<ContentEntry<GuideData | GlossaryTermData>>) => {
    const byLocale = new Map<string, string[]>();
    for (const entry of entries) {
      const calculators = "relatedCalculators" in entry.data ? entry.data.relatedCalculators : [entry.data.relatedCalculator ?? ""];
      const signature = `${entry.data.category} -> ${calculators.join(", ")}`;
      byLocale.set(localeOf(entry.id), [...(byLocale.get(localeOf(entry.id)) ?? []), signature]);
    }
    return [...byLocale].map(([locale, list]) => [locale, list.sort()] as const);
  };

  it.each([
    ["guides", guides.entries],
    ["glossary", glossary.entries],
  ] as const)("%s has the same documents in every locale that has any", (_name, entries) => {
    const [[, first], ...others] = signatures(entries);
    for (const [locale, list] of others) expect(list, locale).toEqual(first);
  });

  it("covers at least en and pt for guides and glossary terms", () => {
    for (const { entries } of [guides, glossary]) {
      expect([...new Set(entries.map((entry) => localeOf(entry.id)))]).toEqual(expect.arrayContaining(["en", "pt"]));
    }
  });
});
