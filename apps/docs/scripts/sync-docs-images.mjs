#!/usr/bin/env node
/**
 * RAD-447: Mirror <DocsImage> refs from content/docs/en MDX files into the
 * pt/ and es/ sibling files, but only when the localized screenshot already
 * exists under public/images/docs/<locale>/<section>/.
 *
 * Re-runnable / idempotent: skips files/blocks that already have a matching
 * DocsImage, and skips locale insertion when the screenshot isn't captured
 * yet (leaving the file untouched for a future run).
 *
 * Usage: node scripts/sync-docs-images.mjs [--dry-run]
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const EN_DIR = join(ROOT, "content/docs/en");
const LOCALES = ["pt", "es"];
const DRY_RUN = process.argv.includes("--dry-run");

const HEADING_RE = /^#{1,6}\s+.*$/gm;
const DOCS_IMAGE_RE = /<DocsImage[\s\S]*?\/>/g;
const SRC_RE = /src="([^"]+)"/;

/** Split file content into sections at heading boundaries.
 * Section 0 = everything before the first heading (frontmatter + intro).
 * Each subsequent section starts at a heading line and runs to (not
 * including) the next heading line, or end of file.
 */
function splitSectionsClean(content) {
  const starts = [];
  let m;
  HEADING_RE.lastIndex = 0;
  while ((m = HEADING_RE.exec(content)) !== null) {
    starts.push(m.index);
  }
  const cuts = [0, ...starts, content.length];
  const sections = [];
  // preamble
  const preambleEnd = starts.length > 0 ? starts[0] : content.length;
  sections.push(content.slice(0, preambleEnd));
  for (let i = 0; i < starts.length; i++) {
    const sectionEnd = i + 1 < starts.length ? starts[i + 1] : content.length;
    sections.push(content.slice(starts[i], sectionEnd));
  }
  return sections;
}

function extractImages(sectionText) {
  const matches = [...sectionText.matchAll(DOCS_IMAGE_RE)];
  return matches.map((m) => m[0]);
}

function localizeImageBlock(block, locale) {
  const srcMatch = SRC_RE.exec(block);
  if (!srcMatch) return null;
  const src = srcMatch[1];
  // src convention: /images/docs/<section>/<file>.png -> insert locale segment
  const localizedSrc = src.replace(
    /^\/images\/docs\//,
    `/images/docs/${locale}/`
  );
  const localizedBlock = block.replace(SRC_RE, `src="${localizedSrc}"`);
  return { localizedBlock, localizedSrc, originalSrc: src };
}

function screenshotExists(localizedSrc) {
  // localizedSrc is a public/ relative URL, e.g. /images/docs/pt/budgets/x.png
  const filePath = join(ROOT, "public", localizedSrc.replace(/^\//, ""));
  return existsSync(filePath);
}

function insertAtSectionEnd(sectionText, blocksToInsert) {
  if (blocksToInsert.length === 0) return sectionText;
  const trimmed = sectionText.replace(/\s+$/, "");
  const insertion = blocksToInsert.map((b) => b).join("\n\n");
  return `${trimmed}\n\n${insertion}\n\n`;
}

function walkMdxFiles(dir) {
  const results = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkMdxFiles(full));
    } else if (entry.isFile() && entry.name.endsWith(".mdx")) {
      results.push(full);
    }
  }
  return results;
}

function relSection(enPath) {
  // content/docs/en/<section>/<slug>.mdx -> { section, slug }
  const rel = enPath.slice(EN_DIR.length + 1); // section/slug.mdx
  const parts = rel.split("/");
  const slug = parts.pop().replace(/\.mdx$/, "");
  const section = parts.join("/");
  return { section, slug };
}

function main() {
  const enFiles = walkMdxFiles(EN_DIR);
  const stats = {};
  for (const locale of LOCALES) stats[locale] = { updated: 0, skippedNoFile: 0, skippedNoShot: 0, alreadyPresent: 0, sectionMismatch: 0 };

  for (const enPath of enFiles) {
    const { section, slug } = relSection(enPath);
    const enContent = readFileSync(enPath, "utf8");
    if (!DOCS_IMAGE_RE.test(enContent)) continue; // reset lastIndex side effect below
    DOCS_IMAGE_RE.lastIndex = 0;

    const enSections = splitSectionsClean(enContent);

    for (const locale of LOCALES) {
      const localePath = join(ROOT, "content/docs", locale, section, `${slug}.mdx`);
      if (!existsSync(localePath)) {
        stats[locale].skippedNoFile++;
        continue;
      }

      const localeContent = readFileSync(localePath, "utf8");
      const localeSections = splitSectionsClean(localeContent);

      if (localeSections.length !== enSections.length) {
        console.warn(
          `[skip: heading mismatch] ${locale}/${section}/${slug}.mdx has ${localeSections.length} sections vs en's ${enSections.length}`
        );
        stats[locale].sectionMismatch++;
        continue;
      }

      let fileChanged = false;
      const newLocaleSections = localeSections.slice();

      for (let i = 0; i < enSections.length; i++) {
        const enBlocks = extractImages(enSections[i]);
        if (enBlocks.length === 0) continue;

        const targetSection = newLocaleSections[i];
        const toInsert = [];

        for (const block of enBlocks) {
          const localized = localizeImageBlock(block, locale);
          if (!localized) continue;
          const { localizedBlock, localizedSrc } = localized;

          // Already present in this locale file anywhere? (idempotency)
          if (localeContent.includes(localizedSrc)) {
            stats[locale].alreadyPresent++;
            continue;
          }

          if (!screenshotExists(localizedSrc)) {
            stats[locale].skippedNoShot++;
            continue;
          }

          toInsert.push(localizedBlock);
        }

        if (toInsert.length > 0) {
          newLocaleSections[i] = insertAtSectionEnd(targetSection, toInsert);
          fileChanged = true;
          stats[locale].updated += toInsert.length;
        }
      }

      if (fileChanged) {
        const newContent = newLocaleSections.join("");
        if (DRY_RUN) {
          console.log(`[dry-run] would update ${localePath}`);
        } else {
          writeFileSync(localePath, newContent, "utf8");
          console.log(`updated ${localePath}`);
        }
      }
    }
  }

  console.log("\nSummary:");
  for (const locale of LOCALES) {
    const s = stats[locale];
    console.log(
      `  ${locale}: inserted=${s.updated} alreadyPresent=${s.alreadyPresent} skippedNoScreenshot=${s.skippedNoShot} skippedNoFile=${s.skippedNoFile} sectionMismatch=${s.sectionMismatch}`
    );
  }
}

main();
