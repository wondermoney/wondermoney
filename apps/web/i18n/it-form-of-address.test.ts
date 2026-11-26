/// <reference types="vite/client" />
import assert from "node:assert/strict";

import { test } from "vitest";

type Messages = Record<string, unknown>;

/*
 * Italian copy addresses the reader as "tu" ("Inserisci la tua email", "i
 * tuoi conti"), never as "Lei" ("Inserisca la Sua email"). These patterns
 * catch the formal form where it is unambiguous: a formal imperative that has
 * no tu reading opening a sentence (an -are verb's "Clicchi" or "Confermi" is
 * also the tu present, so it is not listed), and a capitalised courtesy
 * pronoun in the middle of a sentence. (The same list guards the email copy.)
 */
const FORMAL_ADDRESS = [
  /(?:^|[.!?:…]\s+|\n)(?:Scelga|Inserisca|Apra|Attenda|Faccia|Veda|Mantenga|Acceda|Scriva|Aggiunga|Si assicuri|Si registri|Legga|Prema)(?![\p{L}-])/u,
  /(?<=[\p{Ll},;] )(?:Lei|Suo|Sua|Suoi|Sue)(?!\p{L})/u,
  /(?<!\p{L})(?:La preghiamo|Le chiediamo|Le consigliamo)(?!\p{L})/u,
];

/** `file:key` of it messages that match on purpose, with the reason. */
const EXCEPTIONS: Record<string, string> = {};

const catalogFiles = import.meta.glob<Messages>("../messages/it/*.json", {
  eager: true,
  import: "default",
});

function leaves(value: unknown, prefix = ""): [string, string][] {
  if (typeof value === "string") return [[prefix, value]];
  if (!value || typeof value !== "object") return [];
  return Object.entries(value as Messages).flatMap(([key, child]) =>
    leaves(child, prefix ? `${prefix}.${key}` : key),
  );
}

test("it messages address the reader as tu", () => {
  assert.ok(Object.keys(catalogFiles).length > 0, "no it message files found");
  const found: string[] = [];
  for (const [path, messages] of Object.entries(catalogFiles)) {
    const file = path.split("/").at(-1)!;
    for (const [key, message] of leaves(messages)) {
      const id = `${file}:${key}`;
      if (id in EXCEPTIONS) continue;
      if (FORMAL_ADDRESS.some((pattern) => pattern.test(message))) {
        found.push(`${id}: ${message}`);
      }
    }
  }
  assert.deepEqual(
    found,
    [],
    "Use the tu form, never Lei, or list the key in EXCEPTIONS with a reason",
  );
});

test("every it form-of-address exception still exists and still matches", () => {
  const all = new Map<string, string>(
    Object.entries(catalogFiles).flatMap(([path, messages]) =>
      leaves(messages).map(([key, message]) => [`${path.split("/").at(-1)!}:${key}`, message] as const),
    ),
  );
  for (const id of Object.keys(EXCEPTIONS)) {
    const message = all.get(id);
    assert.ok(message !== undefined, `${id} is listed in EXCEPTIONS but no longer exists`);
    assert.ok(
      FORMAL_ADDRESS.some((pattern) => pattern.test(message)),
      `${id} is listed in EXCEPTIONS but no longer matches; remove it`,
    );
  }
});
