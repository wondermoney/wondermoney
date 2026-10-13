import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

type MessageLeaf = { key: string; value: string };

const root = process.cwd();
const locales = ["en", "pt", "es"] as const;

function read(path: string) {
  return readFileSync(join(root, path), "utf8");
}

/**
 * Blank out comment bodies before scanning a source file for claims.
 *
 * This guard is about what we say to a customer, and a comment says nothing to
 * a customer. Without this, `portfolio-client.tsx` failed on the word
 * "immediately" inside a comment describing where a grid sits on the page —
 * noise that teaches people to distrust the guard rather than the copy.
 *
 * String-aware on purpose: a naive `/\/\*[\s\S]*?\*\//` strip would treat the
 * `/*` inside a literal like `"image/*"` as a comment opener and blank out
 * everything to the next `*​/`, silently blinding the scan over real code.
 * Comment bodies are replaced with spaces rather than removed so that line and
 * column positions stay honest.
 */
function maskComments(source: string): string {
  let out = "";
  let mode: "code" | "line" | "block" | "'" | '"' | "`" = "code";

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    const next = source[i + 1];

    if (mode === "code") {
      if (ch === "/" && next === "/") { mode = "line"; out += "  "; i += 1; continue; }
      if (ch === "/" && next === "*") { mode = "block"; out += "  "; i += 1; continue; }
      if (ch === "'" || ch === '"' || ch === "`") { mode = ch; out += ch; continue; }
      out += ch;
      continue;
    }

    if (mode === "line") {
      if (ch === "\n") { mode = "code"; out += ch; continue; }
      out += " ";
      continue;
    }

    if (mode === "block") {
      if (ch === "*" && next === "/") { mode = "code"; out += "  "; i += 1; continue; }
      out += ch === "\n" ? ch : " ";
      continue;
    }

    // Inside a string literal: copy through, honouring escapes.
    out += ch;
    if (ch === "\\") { out += next ?? ""; i += 1; continue; }
    if (ch === mode) mode = "code";
  }

  return out;
}

function collectFiles(directory: string, extension: RegExp): string[] {
  return readdirSync(join(root, directory), { withFileTypes: true }).flatMap(
    (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return collectFiles(path, extension);
      return entry.isFile() && extension.test(entry.name) ? [path] : [];
    },
  );
}

function messageLeaves(
  value: unknown,
  prefix = "",
): MessageLeaf[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];

  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof child === "string") return [{ key: path, value: child }];
    return messageLeaves(child, path);
  });
}

const prohibitedClaims = [
  /\b30\s*(?:seconds?|segundos?)\b/i,
  /\b(?:a few|few)\s+seconds?\b|\b(?:alguns?|unos?)\s+segundos?\b/i,
  /\binstantly\b|\bimmediately\b|\bimediatamente\b|\bal instante\b|\bal momento\b/i,
  /\breal[- ]time\b|\btempo real\b|\btiempo real\b/i,
  /\bbank[- ]level\b|\bbank[- ]grade\b|\bnível bancário\b|\bnivel bancario\b/i,
  /\b256[- ]bit\b/i,
  /\bcrypto(?:currency|currencies)?\b|\bcriptomonedas?\b|\bcriptoativos?\b|\bcripto\b/i,
  /\bonly European\b|\bapenas europe(?:u|ia)s?\b|\bsó europe(?:u|ia)s?\b|\bsolo europe[oa]s?\b/i,
  /\b(?:full|complete) financial picture\b|\b(?:imagem|visão) financeira completa\b|\b(?:panorama|foto|imagen) financier[oa] complet[oa]\b/i,
] as const;

const allowedMessageClaims = new Set([
  // Operational processing notices are not account-connection result promises.
  "en:common.json:toast-success-processing",
  "pt:common.json:toast-success-processing",
  "es:common.json:toast-success-processing",
]);

/**
 * Polarity.
 *
 * Every pattern above describes a *promise*. The identical phrase inside a
 * denial is its opposite: "Cotação em tempo real indisponível" tells the user
 * we have no real-time quote, which is the disclosure this guard exists to
 * force, not a claim it exists to stop. Matching on the phrase alone made the
 * honest copy fail and would have pushed translators into contortions to avoid
 * naming the capability they were disclaiming.
 *
 * So polarity is decided per match, in the locale of the message, and only
 * within the clause the phrase sits in. Clause boundaries matter: "No waiting
 * — balances update in real time" keeps its "no" in a different clause and
 * stays an offense, which is the whole point.
 */
const clauseBoundary = /[.!?;:,()\n]|—|–/;

// Leading negation: it precedes the claim inside the same clause.
const leadingNegation: Record<(typeof locales)[number], RegExp> = {
  en: /\b(?:not|never|no|without|cannot|can't|isn't|aren't|doesn't|don't|won't|lacks?|lacking|unable)\b/i,
  // Deliberately no bare "no" for pt -- there it is the preposition "in the".
  es: /\b(?:no|nunca|sin|tampoco|carece|carecen)\b/i,
  pt: /\b(?:não|nunca|sem|carece|carecem)\b/i,
};

// Trailing negation: only an explicit statement of absence counts, so that
// "in real time and never late" is not mistaken for a denial.
const trailingNegation: Record<(typeof locales)[number], RegExp> = {
  en: /\b(?:not available|unavailable|not supported|unsupported|not offered)\b/i,
  es: /\b(?:no disponible[s]?|indisponible[s]?|no compatible[s]?)\b/i,
  pt: /\b(?:indisponí(?:vel|veis)|não disponí(?:vel|veis))\b/i,
};

function splitAtBoundary(text: string, fromEnd: boolean) {
  const parts = text.split(clauseBoundary);
  return (fromEnd ? parts.at(-1) : parts[0]) ?? "";
}

function isDenial(
  value: string,
  pattern: RegExp,
  locale: (typeof locales)[number],
) {
  const scan = new RegExp(pattern.source, `${pattern.flags.replace("g", "")}g`);

  for (const match of value.matchAll(scan)) {
    const start = match.index ?? 0;
    const before = splitAtBoundary(value.slice(0, start), true);
    const after = splitAtBoundary(value.slice(start + match[0].length), false);

    // One un-negated occurrence is enough to make the whole string a claim.
    if (
      !leadingNegation[locale].test(before) &&
      !trailingNegation[locale].test(after)
    ) {
      return false;
    }
  }

  return true;
}

const offenses: string[] = [];
for (const locale of locales) {
  for (const path of collectFiles(`messages/${locale}`, /\.json$/)) {
    const fileName = path.split("/").at(-1) ?? path;
    const parsed = JSON.parse(read(path)) as unknown;
    for (const { key, value } of messageLeaves(parsed)) {
      if (
        prohibitedClaims.some(
          (pattern) => pattern.test(value) && !isDenial(value, pattern, locale),
        ) &&
        !allowedMessageClaims.has(`${locale}:${fileName}:${key}`)
      ) {
        offenses.push(`${path}:${key}: ${value}`);
      }
    }
  }
}

const allowedSourceClaims = new Set([
  // Internal API taxonomy; customer-facing labels must stay capability-neutral.
  "components/portfolio/PortfolioHoldingsTable.tsx",
]);
for (const path of [
  ...collectFiles("app", /\.tsx?$/),
  ...collectFiles("components", /\.tsx?$/),
]) {
  const workspacePath = relative(root, join(root, path));
  if (allowedSourceClaims.has(workspacePath)) continue;
  const source = maskComments(read(path));
  const hit = prohibitedClaims.find((pattern) => pattern.test(source));
  if (hit) {
    offenses.push(`${path}: contains a prohibited active claim (${hit})`);
  }
}

assert.deepEqual(
  offenses,
  [],
  `Active EN/PT/ES claims must use approved, supportable wording:\n${offenses.join("\n")}`,
);

const approvedTrust = {
  en: {
    "bank-connection-description":
      "Continue securely to your bank through GoCardless. WonderMoney never receives your credentials.",
    "secure-bank-redirect": "Secure bank redirect",
    "read-only-access": "Read-only; cannot move money",
    "bank-data-updates": "Updates after bank data arrives",
  },
  pt: {
    "bank-connection-description":
      "Continue em segurança para o seu banco através da GoCardless. A WonderMoney nunca recebe as suas credenciais.",
    "secure-bank-redirect": "Redirecionamento bancário seguro",
    "read-only-access": "Só de leitura; não pode mover dinheiro",
    "bank-data-updates": "Atualiza após a chegada dos dados bancários",
  },
  es: {
    "bank-connection-description":
      "Continúa de forma segura a tu banco a través de GoCardless. WonderMoney nunca recibe tus credenciales.",
    "secure-bank-redirect": "Redirección bancaria segura",
    "read-only-access": "Solo lectura; no puede mover dinero",
    "bank-data-updates": "Se actualiza cuando llegan los datos bancarios",
  },
} as const;

for (const locale of locales) {
  const common = JSON.parse(read(`messages/${locale}/common.json`)) as Record<
    string,
    unknown
  >;
  for (const [key, value] of Object.entries(approvedTrust[locale])) {
    assert.equal(common[key], value, `${locale}.${key} must match approved trust copy`);
  }
  // WonderMoney is free: no surface may promise a trial.
  assert.doesNotMatch(
    JSON.stringify(common),
    /14\s+(?:days|dias|días) (?:of full access|de acceso completo|de acesso completo)/i,
    `${locale} must not advertise a trial`,
  );
}

const welcome = read("components/layout/Welcome.tsx");
for (const key of [
  "secure-bank-redirect",
  "read-only-access",
  "bank-data-updates",
]) {
  assert.match(welcome, new RegExp(`t\\("${key}"\\)`));
}
assert.doesNotMatch(welcome, /bank-level-security|thirty-seconds/);

console.log("Active claim regression checks passed");
