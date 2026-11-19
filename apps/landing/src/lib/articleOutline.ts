/**
 * The reading aids of a long-form page (Direction B): the read time in the
 * hero, the quick-jump chips built from the page's section headings, and the
 * "01, 02…" numbers on those headings.
 */

const WORDS_PER_MINUTE = 220;

/** Whole minutes to read the given texts, at least one. */
export function readingMinutes(texts: Iterable<string>): number {
  let words = 0;
  for (const text of texts) words += text.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu)?.length ?? 0;
  return Math.max(1, Math.round(words / WORDS_PER_MINUTE));
}

type PortableTextLike = Readonly<{ _type: string }> & Readonly<Record<string, unknown>>;

/** The plain text of Portable Text blocks, one line per block. */
export function portableTextToPlain(blocks: ReadonlyArray<PortableTextLike>): string {
  return blocks
    .filter((block) => block._type === "block" && Array.isArray(block.children))
    .map((block) =>
      (block.children as ReadonlyArray<{ text?: unknown }>)
        .map((child) => (typeof child.text === "string" ? child.text : ""))
        .join(""),
    )
    .join("\n");
}

export type OutlineEntry = { id: string; title: string };

const slugify = (title: string) =>
  title
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");

/** One entry per non-empty heading, each with an anchor unique on the page. */
export function buildOutline(titles: ReadonlyArray<string | undefined>): OutlineEntry[] {
  const used = new Set<string>();
  const outline: OutlineEntry[] = [];
  titles.forEach((title, index) => {
    if (!title?.trim()) return;
    let id = slugify(title) || `section-${index + 1}`;
    if (used.has(id)) id = `${id}-${index + 1}`;
    used.add(id);
    outline.push({ id, title });
  });
  return outline;
}

/** A section's printed number: 01, 02… */
export const sectionNumber = (index: number) => String(index + 1).padStart(2, "0");
