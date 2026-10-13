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

const stats = read("components/ui/Stats.tsx");
const summary = read("components/portfolio/PortfolioDashboardSummary.tsx");
const enMessages = read("messages/en/common.json");
const ptMessages = read("messages/pt/common.json");

assert(
  stats.includes("unavailableValueLabel?: string"),
  "StatsItem should support a metric-specific unavailable value label",
);

// The generic fallback moved from t("na") ("N/A") to an em-dash — DESIGN_HISTORY.md
// rule 3, so a missing value reads the same everywhere the app renders
// one. What this guard protects is unchanged: a metric that can explain *why*
// it is unavailable must still win over the generic marker.
assert(
  /item\.unavailableValueLabel\s*\?\?\s*"—"/.test(stats),
  "Stats should prefer item.unavailableValueLabel before falling back to the shared em-dash",
);

assert(
  summary.includes("const hasHoldings = summary.assetCount > 0;") ||
    summary.includes("const hasHoldings = summary.assetCount > 0"),
  "PortfolioDashboardSummary should distinguish empty portfolios from insufficient history",
);

assert(
  summary.includes('t("portfolio-metric-unavailable")') &&
    summary.includes('t("period-return-unavailable")') &&
    summary.includes('t("no-holdings")') &&
    summary.includes('t("portfolio-empty-state-description")'),
  "PortfolioDashboardSummary should include distinct copy for insufficient history and empty portfolios",
);

assert(
  summary.includes("periodReturnUnavailableValueLabel") &&
    summary.includes("periodReturnHelperText"),
  "PortfolioDashboardSummary should use derived period return copy constants",
);

assert(
  enMessages.includes('"portfolio-metric-unavailable": "Needs more history"'),
  "English messages should include the period return readiness placeholder copy",
);

assert(
  ptMessages.includes('"portfolio-metric-unavailable": "Precisa de mais histórico"'),
  "Portuguese messages should include the period return readiness placeholder copy",
);

console.log("Portfolio YTD readiness regression checks passed");
