/**
 * Keep every transactional email's copy in en, pt and es with the same shape.
 *
 * Each template keeps its copy in a table beside the component, one entry per
 * language. Nothing connects those tables, so a language can be added to the
 * type and forgotten in a template, or a translation can drop the `(bank,
 * date)` arguments its subject interpolates: the build stays green while a
 * reader gets an English sentence or a literal missing value.
 *
 * Spanish is a recorded gap. `TransactionalEmailLanguage` is `"en" | "pt"` and
 * the Spanish copy has not landed, so every template that still lacks it is
 * listed in SPANISH_COPY_GAP. The check fails when an entry is no longer needed
 * (the Spanish copy arrived) or when a template is missing Spanish without
 * being listed, so the list cannot outlive the gap or hide a new one.
 *
 *   tsx scripts/check-copy-parity.ts
 */
import { COPY as accountConnected } from "../src/templates/account-connected";
import { COPY as bankSyncAlert } from "../src/templates/bank-sync-alert";
import { COPY as budgetThresholdAlert } from "../src/templates/budget-threshold-alert";
import { FOOTER as lifecycleNudge } from "../src/templates/lifecycle-nudge";
import { COPY as monthlyStory } from "../src/templates/monthly-story";
import { COPY as weeklyInsights } from "../src/templates/weekly-insights";
import { COPY as weeklyInsightsPreheader } from "../src/weekly-insights-preheader";

type CopyTable = Record<string, unknown>;

const templates: Array<{ file: string; copy: CopyTable }> = [
  { file: "src/templates/account-connected.tsx", copy: accountConnected },
  { file: "src/templates/bank-sync-alert.tsx", copy: bankSyncAlert },
  { file: "src/templates/budget-threshold-alert.tsx", copy: budgetThresholdAlert },
  { file: "src/templates/lifecycle-nudge.tsx", copy: lifecycleNudge },
  { file: "src/templates/monthly-story.tsx", copy: monthlyStory },
  { file: "src/templates/weekly-insights.tsx", copy: weeklyInsights },
  { file: "src/weekly-insights-preheader.ts", copy: weeklyInsightsPreheader },
];

/**
 * Templates whose Spanish copy is still outstanding. Each entry is a promise
 * that the gap is known; remove it when the copy lands, and the check will
 * insist the Spanish entry actually exists.
 */
const SPANISH_COPY_GAP = new Set([
  "src/templates/account-connected.tsx",
  "src/templates/bank-sync-alert.tsx",
  "src/templates/budget-threshold-alert.tsx",
  "src/templates/lifecycle-nudge.tsx",
  "src/templates/monthly-story.tsx",
  "src/templates/weekly-insights.tsx",
  "src/weekly-insights-preheader.ts",
]);

const LOCALES = ["en", "pt", "es"] as const;

const failures: string[] = [];
const knownGaps: string[] = [];

function describe(value: unknown): string {
  if (Array.isArray(value)) return "an array";
  if (value === null) return "null";
  return typeof value;
}

/**
 * The values a copy function interpolates, read from its declaration. The
 * leading underscore marks an argument the copy deliberately does not use
 * (`_brand`), so it is not part of the contract.
 */
function parameterNames(fn: { toString(): string }): string[] {
  const source = fn.toString();
  const arrow = source.match(/^\s*(?:async\s*)?\(([^)]*)\)\s*=>/);
  const single = source.match(/^\s*(?:async\s*)?([A-Za-z_$][\w$]*)\s*=>/);
  const parameters = arrow?.[1] ?? single?.[1] ?? "";
  return parameters
    .split(",")
    .map((parameter) => parameter.trim().replace(/^_/, ""))
    .filter(Boolean);
}

/**
 * Compare a translation to English. The words may differ; the keys, the kind
 * of each value and the placeholders a function interpolates may not.
 */
function compare(
  reference: unknown,
  candidate: unknown,
  path: string,
  report: (message: string) => void,
): void {
  if (typeof reference === "function") {
    if (typeof candidate !== "function") {
      report(`${path}: expected a function, found ${describe(candidate)}`);
      return;
    }

    const expected = parameterNames(reference);
    const actual = parameterNames(candidate);
    if (expected.join(",") !== actual.join(",")) {
      report(
        `${path}: placeholders differ — expected (${expected.join(", ") || "none"}), found (${actual.join(", ") || "none"})`,
      );
    }
    return;
  }

  if (Array.isArray(reference)) {
    if (!Array.isArray(candidate)) {
      report(`${path}: expected an array, found ${describe(candidate)}`);
      return;
    }
    if (reference.length !== candidate.length) {
      report(`${path}: expected ${reference.length} item(s), found ${candidate.length}`);
    }
    reference.forEach((item, index) => compare(item, candidate[index], `${path}[${index}]`, report));
    return;
  }

  if (reference && typeof reference === "object") {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      report(`${path}: expected an object, found ${describe(candidate)}`);
      return;
    }

    const expectedKeys = Object.keys(reference);
    const actualKeys = Object.keys(candidate);
    for (const key of expectedKeys) {
      if (!(key in candidate)) {
        report(`${path}.${key}: missing`);
      } else {
        compare((reference as CopyTable)[key], (candidate as CopyTable)[key], `${path}.${key}`, report);
      }
    }
    for (const key of actualKeys) {
      if (!(key in reference)) report(`${path}.${key}: not in en`);
    }
    return;
  }

  if (typeof candidate !== typeof reference) {
    report(`${path}: expected ${describe(reference)}, found ${describe(candidate)}`);
  }
}

for (const { file, copy } of templates) {
  if (!copy.en) {
    failures.push(`${file}: no English copy to compare against.`);
    continue;
  }
  if (!copy.pt) failures.push(`${file}: Portuguese copy is missing.`);

  for (const locale of LOCALES) {
    if (locale === "en") continue;

    const translation = copy[locale];
    if (!translation) {
      if (locale === "es" && SPANISH_COPY_GAP.has(file)) {
        knownGaps.push(file);
        continue;
      }

      failures.push(
        `${file}: ${locale} copy is missing — add a "${locale}" entry beside "en"` +
          (locale === "es"
            ? " or list the template in SPANISH_COPY_GAP while the copy is outstanding."
            : "."),
      );
      continue;
    }

    if (locale === "es" && SPANISH_COPY_GAP.has(file)) {
      failures.push(`${file}: Spanish copy exists, so remove the template from SPANISH_COPY_GAP.`);
      continue;
    }

    compare(copy.en, translation, locale, (message) => failures.push(`${file}: ${message}`));
  }
}

const templateFiles = new Set(templates.map((template) => template.file));
for (const file of SPANISH_COPY_GAP) {
  if (!templateFiles.has(file)) {
    failures.push(`${file}: listed in SPANISH_COPY_GAP but there is no such template.`);
  }
}

if (failures.length > 0) {
  console.error(`Email copy parity check failed (${failures.length}):\n`);
  for (const failure of failures) console.error(`  • ${failure}\n`);
  process.exit(1);
}

const gapCount = knownGaps.length;
console.log(
  `Email copy parity check passed — ${templates.length} templates in en and pt with matching placeholders.` +
    (gapCount > 0
      ? ` Spanish copy is still missing (allowed gap, ${gapCount}): ${[...SPANISH_COPY_GAP].sort().join(", ")}.`
      : " Spanish copy is present for every template."),
);
