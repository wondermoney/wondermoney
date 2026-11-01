/**
 * Customer-facing copy must not promise what the product cannot back up:
 * connection or sync speed ("instantly", "in 30 seconds", "real-time"),
 * security marketing ("bank-level", "256-bit"), crypto support, or a
 * "complete financial picture". The same phrase inside a denial ("real-time
 * quote unavailable") is the honest disclosure and is allowed.
 */
import assert from "node:assert/strict";

import { test } from "vitest";

const catalogs = import.meta.glob<Record<string, unknown>>("../messages/*/*.json", {
  eager: true,
  import: "default",
});

const locales = ["en", "pt", "es"] as const;
type Locale = (typeof locales)[number];

type MessageLeaf = { key: string; value: string };

function messageLeaves(value: unknown, prefix = ""): MessageLeaf[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];

  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof child === "string") return [{ key: path, value: child }];
    return messageLeaves(child, path);
  });
}

function catalogsFor(locale: Locale) {
  return Object.entries(catalogs)
    .filter(([path]) => path.includes(`/messages/${locale}/`))
    .map(([path, messages]) => ({ fileName: path.split("/").at(-1)!, messages }));
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
 * Polarity is decided per match, in the message's locale, within the clause
 * the phrase sits in: "No waiting — balances update in real time" keeps its
 * "no" in another clause and is still a claim.
 */
const clauseBoundary = /[.!?;:,()\n]|—|–/;

const leadingNegation: Record<Locale, RegExp> = {
  en: /\b(?:not|never|no|without|cannot|can't|isn't|aren't|doesn't|don't|won't|lacks?|lacking|unable)\b/i,
  // No bare "no" for pt — there it is the preposition "in the".
  es: /\b(?:no|nunca|sin|tampoco|carece|carecen)\b/i,
  pt: /\b(?:não|nunca|sem|carece|carecem)\b/i,
};

// Only an explicit statement of absence counts after the phrase.
const trailingNegation: Record<Locale, RegExp> = {
  en: /\b(?:not available|unavailable|not supported|unsupported|not offered)\b/i,
  es: /\b(?:no disponible[s]?|indisponible[s]?|no compatible[s]?)\b/i,
  pt: /\b(?:indisponí(?:vel|veis)|não disponí(?:vel|veis))\b/i,
};

function splitAtBoundary(text: string, fromEnd: boolean) {
  const parts = text.split(clauseBoundary);
  return (fromEnd ? parts.at(-1) : parts[0]) ?? "";
}

function isDenial(value: string, pattern: RegExp, locale: Locale) {
  const scan = new RegExp(pattern.source, `${pattern.flags.replace("g", "")}g`);

  for (const match of value.matchAll(scan)) {
    const start = match.index ?? 0;
    const before = splitAtBoundary(value.slice(0, start), true);
    const after = splitAtBoundary(value.slice(start + match[0].length), false);

    // One un-negated occurrence is enough to make the whole string a claim.
    if (!leadingNegation[locale].test(before) && !trailingNegation[locale].test(after)) {
      return false;
    }
  }

  return true;
}

function isClaim(value: string, locale: Locale) {
  return prohibitedClaims.some((pattern) => pattern.test(value) && !isDenial(value, pattern, locale));
}

test("the claim detector tells a promise from a denial", () => {
  assert.equal(isClaim("Balances update in real time", "en"), true);
  assert.equal(isClaim("No waiting — balances update in real time", "en"), true);
  assert.equal(isClaim("Real-time quote unavailable", "en"), false);
  assert.equal(isClaim("Cotação em tempo real indisponível", "pt"), false);
  assert.equal(isClaim("Sin cotización en tiempo real", "es"), false);
  assert.equal(isClaim("Read-only; cannot move money", "en"), false);
});

for (const locale of locales) {
  test(`${locale} copy makes no unsupported speed, security or coverage promises`, () => {
    const files = catalogsFor(locale);
    assert.ok(files.length > 0, `no ${locale} message catalogs were loaded`);

    const offenses = files.flatMap(({ fileName, messages }) =>
      messageLeaves(messages)
        .filter(({ key, value }) => isClaim(value, locale) && !allowedMessageClaims.has(`${locale}:${fileName}:${key}`))
        .map(({ key, value }) => `${fileName}:${key}: ${value}`),
    );

    assert.deepEqual(offenses, []);
  });

  test(`${locale} copy does not advertise a trial — the product is free`, () => {
    const common = catalogsFor(locale).find(({ fileName }) => fileName === "common.json");
    assert.ok(common);
    assert.doesNotMatch(
      JSON.stringify(common.messages),
      /14\s+(?:days|dias|días) (?:of full access|de acceso completo|de acesso completo)/i,
    );
  });
}
