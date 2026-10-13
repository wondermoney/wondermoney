/**
 * General locale-quality guards salvaged from the deleted monetization checks;
 * these are about wording, not about the (since removed) paid product.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function read(path: string) {
  return readFileSync(path, "utf8");
}

const esCommonMessages = read("messages/es/common.json");
const ptCommonMessages = read("messages/pt/common.json");

// Spanish copy once said "Guardar" where the approved word is "Ahorra".
assert.doesNotMatch(
  esCommonMessages,
  /"save2"\s*:\s*"Guardar"/,
  "Spanish pricing copy should use Ahorra, not Guardar",
);

// A feature list once exposed internal "Relatórios em beta" wording.
assert.doesNotMatch(
  ptCommonMessages,
  /Relatórios em beta/,
  "Portuguese copy should not expose beta wording",
);

console.log("Locale quality regression checks passed");
