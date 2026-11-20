import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { CONTENT_DIRECTORIES, glossaryTermSchema, guideSchema, monthlySchema } from "./content/schemas";

/**
 * One Markdown file per document and locale: `src/content/<directory>/<locale>/<slug>.md`.
 * The entry id is that path without the extension (`pt/taeg`), so the locale and the slug
 * always come from the file's place, never from a slugified copy of it.
 */
const markdownIn = (directory: string) =>
  glob({
    pattern: "*/*.md",
    base: `./src/content/${directory}`,
    generateId: ({ entry }) => entry.replace(/\.md$/, ""),
  });

export const collections = {
  guides: defineCollection({ loader: markdownIn(CONTENT_DIRECTORIES.guides), schema: guideSchema }),
  glossary: defineCollection({ loader: markdownIn(CONTENT_DIRECTORIES.glossary), schema: glossaryTermSchema }),
  monthly: defineCollection({ loader: markdownIn(CONTENT_DIRECTORIES.monthly), schema: monthlySchema }),
};
