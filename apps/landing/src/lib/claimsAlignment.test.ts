import { describe, expect, it } from "vitest";
import { classifyMatch, scanClaims, scanContent } from "../../scripts/claims-alignment.mjs";

describe("public claims alignment", () => {
  it("finds no unsupported claims in active source or locale mirrors", () => {
    expect(scanClaims().filter(({ classification }) => classification === "claim")).toEqual([]);
  });

  it("classifies non-active matches instead of treating them as product claims", () => {
    expect(classifyMatch("src/lib/providerClient.ts")).toBe("technical");
    expect(classifyMatch("docs/historical-launch.md")).toBe("historical");
    expect(classifyMatch("src/lib/routes.test.ts")).toBe("not-claim");
    expect(classifyMatch("src/components/pages/HomePage.astro")).toBe("claim");
    expect(classifyMatch("src/lib/resources/curatedLists/events.ts")).toBe("not-claim");
    expect(classifyMatch("src/lib/resources/curatedLists/page.ts")).toBe("claim");
    expect(classifyMatch("src/locales/en/common.json", "Disconnect your bank immediately.")).toBe("not-claim");
    expect(classifyMatch("src/lib/envelope.ts", 'import { createHmac } from "node:crypto";')).toBe("technical");
    expect(classifyMatch("src/layouts/Layout.astro", 'crossorigin="anonymous"')).toBe("technical");
    expect(classifyMatch("src/lib/hairline/kernel.js")).toBe("technical");
    expect(classifyMatch("src/lib/hairline/figures/jar.js")).toBe("technical");
    expect(classifyMatch("src/lib/hairline/articleFigures.ts")).toBe("claim");
  });

  it("reads \"segundo plano\" as the background, not as seconds", () => {
    const matches = scanContent("src/components/Claim.astro", [
      "A importação corre em segundo plano.",
      "La importación se ejecuta en segundo plano.",
      "Liga o banco em 30 segundos.",
      "Conecta en segundos.",
    ].join("\n"));

    expect(matches.map(({ text }) => text)).toEqual(["em 30 segundos", "en segundos"]);
  });

  it("detects expanded timing, security, and crypto variants", () => {
    const matches = scanContent("src/components/Claim.astro", [
      "Connect in minutes.",
      "Empieza en 3 minutos.",
      "Transactions are available immediately.",
      "Ogni nuova transazione viene letta immediatamente.",
      "Cifrado de nivel bancario.",
      "Ações e cripto.",
    ].join("\n"));

    expect(matches.map(({ rule }) => rule)).toEqual([
      "setup/import timing",
      "setup/import timing",
      "immediate processing",
      "immediate processing",
      "crypto positioning",
      "unsupported security/legal guarantee",
    ]);
    expect(matches.every(({ classification }) => classification === "claim")).toBe(true);
  });
});
