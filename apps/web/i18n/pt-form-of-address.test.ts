/// <reference types="vite/client" />
import assert from "node:assert/strict";

import { test } from "vitest";

type Messages = Record<string, unknown>;

/*
 * European Portuguese copy addresses the reader as "tu" ("Introduz o teu
 * email"), never as "você" or in the formal third person ("Introduza o seu
 * email"); CONTRIBUTING.md has the rule. These patterns catch the formal form
 * where it is unambiguous: "você" anywhere, and a formal imperative opening a
 * sentence. (The same list guards the mobile and email copy.)
 */
const FORMAL_ADDRESS = [
  /(?<!\p{L})[Vv]ocê(?!\p{L})/u,
  /(?:^|[.!?:…]\s+|\n)(?:Clique|Toque|Adicione|Escolha|Selecione|Digite|Escreva|Insira|Introduza|Confirme|Verifique|Tente|Utilize|Aceda|Experimente|Certifique-se|Inicie|Registe-se|Contacte|Aguarde|Reveja|Volte|Abra|Crie|Guarde|Ligue|Faça|Veja|Consulte|Descarregue|Elimine|Mantenha)(?![\p{L}-])/u,
];

/** `file:key` of pt messages that match on purpose, with the reason. */
const EXCEPTIONS: Record<string, string> = {};

const catalogFiles = import.meta.glob<Messages>("../messages/pt/*.json", {
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

test("pt messages address the reader as tu", () => {
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
    "Use the tu form (CONTRIBUTING.md), or list the key in EXCEPTIONS with a reason",
  );
});

test("every pt form-of-address exception still exists and still matches", () => {
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
