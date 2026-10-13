import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function assert(condition: unknown, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

function read(relativePath: string) {
  return readFileSync(join(root, relativePath), "utf8");
}

const modal = read("components/portfolio/PortfolioSettingsModal.tsx");
const enMessages = read("messages/en/common.json");
const ptMessages = read("messages/pt/common.json");
const esMessages = read("messages/es/common.json");

for (const removedToken of [
  "benchmarkSymbol",
  "portfolio-benchmark",
  "benchmark-symbol",
  "excluded",
  "favored",
]) {
  assert(
    !modal.includes(removedToken),
    `PortfolioSettingsModal should not contain removed setting token: ${removedToken}`,
  );
}

assert(
  !modal.includes("@/components/ui/switch"),
  "PortfolioSettingsModal should not import Switch after removing boolean portfolio settings",
);

for (const [locale, messages] of [
  ["en", enMessages],
  ["pt", ptMessages],
  ["es", esMessages],
] as const) {
  for (const removedKey of [
    "benchmark-symbol",
    "excluded",
    "excluded-description",
    "favored",
    "favored-description",
  ]) {
    assert(
      !messages.includes(`"${removedKey}"`),
      `${locale} messages should not keep unused portfolio settings key: ${removedKey}`,
    );
  }
}

console.log("Portfolio settings modal regression checks passed");
