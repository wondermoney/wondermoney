/**
 * RAD-577 — keep the Privacy Policy's sub-processor list and the running stack in sync.
 *
 * The failure this guards against already happened. RAD-449 replaced Financial Modeling
 * Prep with EODHD on 2026-08-05; §12 went on naming FMP until RAD-573 noticed while
 * translating the policy into Spanish. For eleven weeks the policy disclosed processing
 * that had stopped and omitted processing that had started, in all three locales, with a
 * green build the whole time — because nothing connected the dependency list to the legal
 * text.
 *
 * This connects them. `content/sub-processors.json` is the source of truth. Every entry
 * with a heading must appear in all three locale policies; every processor heading in a
 * policy must have an entry. An entry marked MISSING_FROM_POLICY is a known, recorded gap
 * and is reported rather than silently tolerated — the check fails while any remain, so
 * "we know about it" cannot quietly become "we live with it".
 *
 *   node scripts/check-sub-processors.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const POLICIES = {
  en: 'app/(legal)/about/privacy-policy/page.mdx',
  pt: 'app/(legal-pt)/pt/about/privacy-policy/page.mdx',
  es: 'app/(legal-es)/es/about/privacy-policy/page.mdx',
};

/**
 * Headings inside §12–15 that introduce a third party, as opposed to structuring the
 * document. Anything else at `###` level in those sections is prose.
 */
const NON_PROCESSOR_HEADINGS = new Set([]);

const manifest = JSON.parse(readFileSync(join(root, 'content/sub-processors.json'), 'utf8'));
const failures = [];

/** The `###` headings between "## 12." and "## 16.", where the processors live. */
function processorHeadings(source) {
  const start = source.search(/^## 12\./m);
  const end = source.search(/^## 16\./m);
  if (start === -1 || end === -1) {
    return null;
  }
  return source
    .slice(start, end)
    .split('\n')
    .filter((line) => line.startsWith('### '))
    .map((line) => line.slice(4).trim())
    .filter((heading) => !NON_PROCESSOR_HEADINGS.has(heading));
}

const headingsByLocale = {};
for (const [locale, path] of Object.entries(POLICIES)) {
  const headings = processorHeadings(readFileSync(join(root, path), 'utf8'));
  if (headings === null) {
    failures.push(`${path}: could not find the "## 12." … "## 16." range — has the policy been renumbered?`);
    continue;
  }
  headingsByLocale[locale] = headings;
}

// Stripe is named in §15 as bold text rather than a heading, because §15 is about payment
// processing generally and Stripe is one instance of it. Treat it as present.
for (const [locale, path] of Object.entries(POLICIES)) {
  if (headingsByLocale[locale] && readFileSync(join(root, path), 'utf8').includes('**Stripe**')) {
    headingsByLocale[locale].push('Stripe');
  }
}

for (const processor of manifest.processors) {
  if (processor.status === 'MISSING_FROM_POLICY') {
    failures.push(
      `${processor.id}: in use but not disclosed — ${processor.purpose} ` +
        `Personal data: ${processor.personalData} (${processor.location}). ` +
        `Add a section to all three policies and clear \`status\`.`,
    );
    continue;
  }

  for (const [locale, headings] of Object.entries(headingsByLocale)) {
    const expected = processor.heading?.[locale];
    if (!expected) {
      failures.push(`${processor.id}: no \`heading.${locale}\` in the manifest.`);
      continue;
    }
    if (!headings.includes(expected)) {
      failures.push(`${processor.id}: "${expected}" is missing from ${POLICIES[locale]}.`);
    }
  }
}

// The other direction: a policy naming someone the manifest has never heard of. That is
// how a decommissioned provider survives — the entry stays, and nothing objects.
const declared = new Set(
  manifest.processors.flatMap((processor) => Object.values(processor.heading ?? {}).filter(Boolean)),
);
for (const [locale, headings] of Object.entries(headingsByLocale)) {
  for (const heading of headings) {
    if (!declared.has(heading)) {
      failures.push(
        `${POLICIES[locale]} discloses "${heading}", which has no entry in content/sub-processors.json. ` +
          'Either it is still in use and belongs in the manifest, or it is not and belongs out of the policy.',
      );
    }
  }
}

if (failures.length > 0) {
  console.error(`Sub-processor check failed (${failures.length}):\n`);
  for (const failure of failures) console.error(`  • ${failure}\n`);
  process.exit(1);
}

console.log(
  `Sub-processor check passed — ${manifest.processors.length} processors, disclosed in all ${Object.keys(POLICIES).length} locales. ` +
    `Last verified against the running stack: ${manifest.verifiedAt}.`,
);
