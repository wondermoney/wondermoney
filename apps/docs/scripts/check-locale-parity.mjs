/**
 * Keep the three documentation locales in step.
 *
 * A page that exists only in English is invisible to a Portuguese or Spanish
 * reader, and Fumadocs builds each sidebar from that locale's `meta.json`, so an
 * entry added to one locale's navigation and not the others silently drops a
 * page from the other sidebars. Both failures ship with a green build because
 * nothing compares the locale trees.
 *
 * This compares them: every `.mdx` page and `meta.json` must exist in `en`,
 * `pt` and `es`, and every `meta.json` must list the same pages in the same
 * order. The failure names the locale, the file and the entry, so the fix is
 * adding the missing sibling rather than reading this script.
 *
 *   node scripts/check-locale-parity.mjs
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const content = join(root, 'content/docs');

const LOCALES = ['en', 'pt', 'es'];
const DEFAULT_LOCALE = 'en';

const failures = [];

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

function filesByLocale(locale) {
  const directory = join(content, locale);
  return new Map(
    walk(directory).map((path) => [relative(directory, path).split(sep).join('/'), path]),
  );
}

const localeFiles = Object.fromEntries(LOCALES.map((locale) => [locale, filesByLocale(locale)]));
const referenceFiles = localeFiles[DEFAULT_LOCALE];

for (const locale of LOCALES) {
  if (locale === DEFAULT_LOCALE) continue;

  const files = localeFiles[locale];

  for (const file of referenceFiles.keys()) {
    if (!files.has(file)) {
      failures.push(
        `${locale}: "${file}" exists in ${DEFAULT_LOCALE} but not in ${locale}. ` +
          `Add apps/docs/content/docs/${locale}/${file}.`,
      );
    }
  }

  for (const file of files.keys()) {
    if (!referenceFiles.has(file)) {
      failures.push(
        `${locale}: "${file}" has no ${DEFAULT_LOCALE} counterpart. ` +
          `Add apps/docs/content/docs/${DEFAULT_LOCALE}/${file} or remove the ${locale} file.`,
      );
    }
  }
}

/** `pages` entries may be a slug or a `[title](url)`-style object; compare both. */
const entryKey = (entry) => (typeof entry === 'string' ? entry : JSON.stringify(entry));

for (const [file, referencePath] of referenceFiles) {
  if (!file.endsWith('meta.json')) continue;

  const reference = JSON.parse(readFileSync(referencePath, 'utf8'));
  if (!Array.isArray(reference.pages)) {
    failures.push(`${DEFAULT_LOCALE}/${file}: "pages" is missing or is not an array.`);
    continue;
  }

  const expected = reference.pages.map(entryKey);

  for (const locale of LOCALES) {
    if (locale === DEFAULT_LOCALE) continue;

    const path = localeFiles[locale].get(file);
    if (!path) continue; // Reported above as a missing file.

    const meta = JSON.parse(readFileSync(path, 'utf8'));
    if (!Array.isArray(meta.pages)) {
      failures.push(`${locale}/${file}: "pages" is missing or is not an array.`);
      continue;
    }

    const actual = meta.pages.map(entryKey);

    for (const entry of expected) {
      if (!actual.includes(entry)) {
        failures.push(
          `${locale}/${file}: "pages" is missing "${entry}", which ${DEFAULT_LOCALE}/${file} lists. ` +
            'Add the same entry to the other locales.',
        );
      }
    }
    for (const entry of actual) {
      if (!expected.includes(entry)) {
        failures.push(
          `${locale}/${file}: "pages" lists "${entry}", which ${DEFAULT_LOCALE}/${file} does not. ` +
            `Add it to ${DEFAULT_LOCALE}/${file} or remove it from ${locale}.`,
        );
      }
    }

    const sameOrder =
      expected.length === actual.length &&
      expected.every((entry, index) => entry === actual[index]);
    const sameEntries =
      expected.every((entry) => actual.includes(entry)) &&
      actual.every((entry) => expected.includes(entry));

    if (!sameOrder && sameEntries) {
      failures.push(
        `${locale}/${file}: "pages" order differs from ${DEFAULT_LOCALE}/${file}. ` +
          'Keep the navigation order the same in every locale.',
      );
    }
  }
}

if (failures.length > 0) {
  console.error(`Locale parity check failed (${failures.length}):\n`);
  for (const failure of failures) console.error(`  • ${failure}\n`);
  process.exit(1);
}

const pageCount = [...referenceFiles.keys()].filter((file) => file.endsWith('.mdx')).length;
const metaCount = [...referenceFiles.keys()].filter((file) => file.endsWith('meta.json')).length;
console.log(
  `Locale parity check passed — ${pageCount} pages and ${metaCount} navigation files in all ${LOCALES.length} locales.`,
);
