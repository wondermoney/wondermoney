/**
 * Keep every transactional email's copy in en, pt and es with the same shape.
 *
 * Each template keeps its copy in a table beside the component, one entry per
 * language. Nothing connects those tables, so a language can be added to the
 * type and forgotten in a template, or a translation can drop the `(bank,
 * date)` arguments its subject interpolates: the build stays green while a
 * reader gets an English sentence or a literal missing value.
 *
 * Every template must carry en, pt and es copy. A missing language fails the
 * check, so a template cannot ship English to a Spanish account by omission.
 *
 * Portuguese copy addresses the reader as "tu" ("Recebes este email…"), never
 * as "você" or in the formal third person (CONTRIBUTING.md has the rule), so
 * the pt entries also fail on "você" or a formal imperative opening a sentence.
 * The same patterns guard the web and mobile copy. Spanish copy uses "tú" too,
 * so the es entries fail on "usted" or "Ud.".
 *
 *   tsx scripts/check-copy-parity.ts
 */
import { SHELL_COPY as lifecycleShell } from "../emails/components/LifecycleEmail";
import { COPY as accountConnected } from "../src/templates/account-connected";
import { COPY as bankSyncAlert } from "../src/templates/bank-sync-alert";
import { COPY as budgetThresholdAlert } from "../src/templates/budget-threshold-alert";
import { COPY as creditCardDueReminder } from "../src/templates/credit-card-due-reminder";
import { COPY as emailVerification } from "../src/templates/email-verification";
import { COPY as householdInvite } from "../src/templates/household-invite";
import { FOOTER as lifecycleNudge } from "../src/templates/lifecycle-nudge";
import { COPY as monthlyStory } from "../src/templates/monthly-story";
import { COPY as passwordReset } from "../src/templates/password-reset";
import { COPY as weeklyInsights } from "../src/templates/weekly-insights";
import { COPY as weeklyInsightsPreheader } from "../src/weekly-insights-preheader";

type CopyTable = Record<string, unknown>;

const templates: Array<{ file: string; copy: CopyTable }> = [
  { file: "src/templates/account-connected.tsx", copy: accountConnected },
  { file: "src/templates/bank-sync-alert.tsx", copy: bankSyncAlert },
  { file: "src/templates/budget-threshold-alert.tsx", copy: budgetThresholdAlert },
  { file: "src/templates/credit-card-due-reminder.tsx", copy: creditCardDueReminder },
  { file: "emails/components/LifecycleEmail.tsx", copy: lifecycleShell },
  { file: "src/templates/email-verification.tsx", copy: emailVerification },
  { file: "src/templates/household-invite.tsx", copy: householdInvite },
  { file: "src/templates/lifecycle-nudge.tsx", copy: lifecycleNudge },
  { file: "src/templates/monthly-story.tsx", copy: monthlyStory },
  { file: "src/templates/password-reset.tsx", copy: passwordReset },
  { file: "src/templates/weekly-insights.tsx", copy: weeklyInsights },
  { file: "src/weekly-insights-preheader.ts", copy: weeklyInsightsPreheader },
];

const LOCALES = ["en", "pt", "es"] as const;

const FORMAL_ADDRESS = [
  /(?<!\p{L})[Vv]ocê(?!\p{L})/u,
  /(?:^|[.!?:…]\s+|\n|`)(?:Clique|Toque|Adicione|Escolha|Selecione|Digite|Escreva|Insira|Introduza|Confirme|Verifique|Tente|Utilize|Aceda|Experimente|Certifique-se|Inicie|Registe-se|Contacte|Aguarde|Reveja|Volte|Abra|Crie|Guarde|Ligue|Faça|Veja|Consulte|Descarregue|Elimine|Mantenha)(?![\p{L}-])/u,
];

const SPANISH_FORMAL_ADDRESS = /(?<!\p{L})(?:[Uu]sted(?:es)?|Uds?\.)(?!\p{L})/u;

const failures: string[] = [];

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

/** Every string in a copy entry, and the source of every copy function (its template literal). */
function copyText(value: unknown, path: string): Array<[string, string]> {
  if (typeof value === "string") return [[path, value]];
  if (typeof value === "function") return [[path, value.toString()]];
  if (Array.isArray(value)) return value.flatMap((item, index) => copyText(item, `${path}[${index}]`));
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, child]) => copyText(child, `${path}.${key}`));
  }
  return [];
}

for (const { file, copy } of templates) {
  for (const [path, text] of copyText(copy.pt, "pt")) {
    if (FORMAL_ADDRESS.some((pattern) => pattern.test(text))) {
      failures.push(`${file}: ${path} addresses the reader formally; use the "tu" form (CONTRIBUTING.md).`);
    }
  }

  for (const [path, text] of copyText(copy.es, "es")) {
    if (SPANISH_FORMAL_ADDRESS.test(text)) {
      failures.push(`${file}: ${path} addresses the reader as "usted"; use the "tú" form.`);
    }
  }

  if (!copy.en) {
    failures.push(`${file}: no English copy to compare against.`);
    continue;
  }
  if (!copy.pt) failures.push(`${file}: Portuguese copy is missing.`);

  for (const locale of LOCALES) {
    if (locale === "en") continue;

    const translation = copy[locale];
    if (!translation) {
      failures.push(`${file}: ${locale} copy is missing — add a "${locale}" entry beside "en".`);
      continue;
    }

    compare(copy.en, translation, locale, (message) => failures.push(`${file}: ${message}`));
  }
}

if (failures.length > 0) {
  console.error(`Email copy parity check failed (${failures.length}):\n`);
  for (const failure of failures) console.error(`  • ${failure}\n`);
  process.exit(1);
}

console.log(
  `Email copy parity check passed — ${templates.length} templates in en, pt and es with matching placeholders.`,
);
