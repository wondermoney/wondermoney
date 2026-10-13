import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

function read(path: string) {
  return readFileSync(path, "utf8");
}

function walkFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];

  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const files: string[] = [];

  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(path));
      continue;
    }

    if (entry.isFile()) {
      files.push(path);
    }
  }

  return files;
}

const failures: string[] = [];
const expectedChartModules = [
  "chart-axis",
  "chart-card",
  "chart-formatters",
  "area-line-chart-base",
  "composed-area-bar-chart-base",
  "bar-chart-base",
  "pie-chart-base",
  "scatter-chart-base",
];

function check(condition: boolean, message: string) {
  if (!condition) failures.push(message);
}

function checkMatch(source: string, pattern: RegExp, message: string) {
  check(pattern.test(source), message);
}

function checkNotMatch(source: string, pattern: RegExp, message: string) {
  check(!pattern.test(source), message);
}

function getImportDeclarations(source: string) {
  return [...source.matchAll(/^import[\s\S]*?;$/gm)].map(([block]) => block);
}

function checkChartIndexExports(source: string) {
  for (const moduleName of expectedChartModules) {
    checkMatch(
      source,
      new RegExp(
        String.raw`export\s+(?:\*|\{[^}]*\}|type\s+\{[^}]*\})\s+from\s+["']\./${moduleName}["']`,
      ),
      `components/ui/charts/index.ts should export ${moduleName}`,
    );
  }
}

function checkNivoImports(source: string, file: string) {
  const sourceDetails = new Set<string>();
  const responsiveDetails = new Set<string>();
  const directImportPattern = /from\s+["'](@nivo\/[^"']+)["']/g;
  const responsiveImports = [
    "ResponsiveLine",
    "ResponsiveBar",
    "ResponsivePie",
    "ResponsiveScatterPlot",
    "ResponsiveTreeMap",
  ] as const;

  for (const importBlock of getImportDeclarations(source)) {
    const sources = [...importBlock.matchAll(directImportPattern)].map((match) => match[1]);
    if (sources.length === 0) continue;

    const uniqueSources = [...new Set(sources)];
    for (const moduleSource of uniqueSources) {
      sourceDetails.add(`${file} imports from ${moduleSource}`);
    }

    for (const importName of responsiveImports) {
      if (new RegExp(String.raw`\b${importName}\b`).test(importBlock)) {
        responsiveDetails.add(`${importName} from ${uniqueSources.join(", ")}`);
      }
    }
  }

  for (const failure of sourceDetails) failures.push(failure);
  if (responsiveDetails.size > 0) {
    failures.push(`${file} also uses responsive bindings (${[...responsiveDetails].join(", ")})`);
  }
}


// This check used to assert package.json exposed a `test:<domain>` script for
// itself. `pnpm test` replaced those 50 scripts with one Vitest run, and
// scripts/regression-checks.test.ts now enumerates this file from disk, so
// being wired in is structural rather than something to string-match.

const chartUi = read("components/ui/chart.tsx");

const chartIndexPath = "components/ui/charts/index.ts";
if (!existsSync(chartIndexPath)) {
  failures.push(`${chartIndexPath} should exist`);
  for (const moduleName of expectedChartModules) {
    failures.push(`${chartIndexPath} should export ${moduleName}`);
  }
} else {
  checkChartIndexExports(read(chartIndexPath));
}

checkNotMatch(
  chartUi,
  /\{item\.value\s*&&\s*\(/,
  "components/ui/chart.tsx should not drop zero-valued tooltip items",
);

checkNotMatch(
  chartUi,
  /text-gray-800/,
  "components/ui/chart.tsx legend should no longer use text-gray-800",
);

const featureRoots = [
  "components/account",
  "components/budget",
  "components/portfolio",
  "components/financial-market",
];

for (const root of featureRoots) {
  for (const file of walkFiles(root).filter((file) => file.endsWith(".tsx") || file.endsWith(".ts"))) {
    const source = read(file);

    checkNotMatch(
      source,
      /from\s+["'][^"']*Charts(?:New)?[^"']*["']/, 
      `${file} should not import from legacy chart component paths`,
    );

    checkNotMatch(
      source,
      /from\s+["'][^"']*legacy-charts[^"']*["']/, 
      `${file} should not import from legacy chart component paths`,
    );

    checkNivoImports(source, file);
  }
}

if (failures.length > 0) {
  console.error("Chart system regression checks failed:\n");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Chart system regression checks passed");
