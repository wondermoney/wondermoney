import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const packageRoot = process.cwd();
const approvedTempRoot = resolve(tmpdir(), "opencode");
await mkdir(approvedTempRoot, { recursive: true });
const tempRoot = await mkdtemp(join(approvedTempRoot, "react-email-package-"));

const previewMarkers = [
  "PreviewProps",
  "Marta",
  "EXEMPLO",
  "€428,30",
  "€436,80",
  "julho de 2026",
  "6 a 12 de julho de 2026",
];

function run(command: string, args: string[], cwd = packageRoot): string {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
}

try {
  const distFiles = (await readdir(resolve(packageRoot, "dist"))).sort();
  assert.deepEqual(distFiles, [
    "index.d.ts",
    "index.js",
    "lifecycle-copy.d.ts",
    "lifecycle-dynamic.d.ts",
    "types.d.ts",
    "weekly-insights-preheader.d.ts",
  ]);

  for (const file of distFiles) {
    const content = await readFile(resolve(packageRoot, "dist", file), "utf8");
    for (const marker of previewMarkers) {
      assert.ok(!content.includes(marker), `${file} contains preview marker ${marker}`);
    }
  }

  const packResult = JSON.parse(
    run("npm", ["pack", "--json", "--pack-destination", tempRoot]),
  ) as Array<{ filename: string; files: Array<{ path: string }> }>;
  assert.equal(packResult.length, 1);
  const packedFiles = packResult[0].files.map(({ path }) => path).sort();
  assert.deepEqual(packedFiles, [
    "LICENSE",
    "README.md",
    "dist/index.d.ts",
    "dist/index.js",
    "dist/lifecycle-copy.d.ts",
    "dist/lifecycle-dynamic.d.ts",
    "dist/types.d.ts",
    "dist/weekly-insights-preheader.d.ts",
    "package.json",
  ]);

  const archivePath = resolve(tempRoot, packResult[0].filename);
  await writeFile(
    resolve(tempRoot, "package.json"),
    JSON.stringify({ name: "package-artifact-consumer", private: true, type: "module" }),
  );
  run("npm", [
    "install",
    "--no-audit",
    "--no-fund",
    archivePath,
    "typescript@7.0.2",
    "@types/node@26.1.1",
  ], tempRoot);

  const installedPackageJson = JSON.parse(
    await readFile(resolve(tempRoot, "node_modules/@wondermoney/react-email/package.json"), "utf8"),
  ) as { name: string; version: string; exports: unknown; files: string[] };
  const sourcePackageJson = JSON.parse(
    await readFile(resolve(packageRoot, "package.json"), "utf8"),
  ) as { version: string };
  assert.equal(installedPackageJson.name, "@wondermoney/react-email");
  assert.equal(installedPackageJson.version, sourcePackageJson.version);
  assert.deepEqual(installedPackageJson.files, ["dist"]);
  assert.deepEqual(installedPackageJson.exports, {
    ".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
  });

  await writeFile(
    resolve(tempRoot, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        types: ["node"],
      },
      include: ["consumer.mts"],
    }),
  );
  await writeFile(
    resolve(tempRoot, "consumer.mts"),
    `import {
  getWeeklyInsightsPreheader,
  renderBudgetThresholdAlert,
  renderWeeklyInsights,
  type BudgetThresholdAlertProps,
  type WeeklyInsightsProps,
} from "@wondermoney/react-email";

const urls = {
  ctaUrl: "https://app.wonder.money/pt/budgets",
  settingsUrl: "https://app.wonder.money/pt/settings",
  privacyUrl: "https://docs.wonder.money/pt/privacy",
  unsubscribeUrl: "https://app.wonder.money/unsubscribe/token",
};
const budget: BudgetThresholdAlertProps = {
  periodLabel: "consumer period",
  items: [{ budgetName: "B", categoryName: "C", state: "near", threshold: 80, formattedPercentageUsed: "80%", formattedSpent: "€8", formattedBudgeted: "€10", formattedRemainingOrOver: "€2" }],
  ...urls,
};
const weekly: WeeklyInsightsProps = {
  weekDateRange: "consumer week",
  formattedTotalSpending: "€8",
  topCategoryDisplay: "C",
  formattedTopCategoryAmount: "€8",
  dataContext: "consumer context",
  ...urls,
};
void renderBudgetThresholdAlert(budget);
void renderWeeklyInsights(weekly);
const preheader: string = getWeeklyInsightsPreheader(undefined);
void preheader;
`,
  );
  run(resolve(tempRoot, "node_modules/.bin/tsc"), ["-p", "tsconfig.json"], tempRoot);

  await writeFile(
    resolve(tempRoot, "verify-runtime.mjs"),
    `import assert from "node:assert/strict";
import { renderBudgetThresholdAlert, renderWeeklyInsights } from "@wondermoney/react-email";
const unsafe = '<script>alert("artifact")</script><strong>unsafe</strong>';
const urls = { ctaUrl: "https://app.wonder.money/pt/budgets", settingsUrl: "https://app.wonder.money/pt/settings", privacyUrl: "https://docs.wonder.money/pt/privacy", unsubscribeUrl: "https://app.wonder.money/unsubscribe/token" };
const budget = await renderBudgetThresholdAlert({ firstName: unsafe, periodLabel: unsafe, items: [{ budgetName: unsafe, categoryName: unsafe, state: "near", threshold: 80, formattedPercentageUsed: "80%", formattedSpent: "€8", formattedBudgeted: "€10", formattedRemainingOrOver: "€2" }], ...urls });
const weekly = await renderWeeklyInsights({ firstName: unsafe, weekDateRange: unsafe, formattedTotalSpending: "€8", topCategoryDisplay: unsafe, formattedTopCategoryAmount: "€8", dataContext: unsafe, ...urls });
for (const rendered of [budget, weekly]) {
  assert.ok(rendered.html);
  assert.ok(rendered.text);
  assert.ok(!rendered.html.includes('<script>alert("artifact")</script>'));
  assert.ok(rendered.html.includes("&lt;script&gt;"));
}
console.log("Node", process.versions.node, "artifact import and escaping verified");
`,
  );

  if (process.versions.node.split(".")[0] === "22") {
    console.log(run(process.execPath, ["verify-runtime.mjs"], tempRoot).trim());
  } else {
    console.log(run("npx", ["--yes", "node@22.17.0", "verify-runtime.mjs"], tempRoot).trim());
  }

  console.log(`Package artifact verified: ${packedFiles.join(", ")}`);
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
