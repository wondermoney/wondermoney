/**
 * RAD-552 — the cash flow report must not invent months.
 *
 * The chart used to plot the API response verbatim, which meant months outside
 * the selected period were drawn at ~zero and months with no data vanished
 * without leaving a gap. These checks pin the shape of the fix at the source
 * level: the series is rebuilt, nulls are not bridged, and the partial-month
 * copy exists in every supported locale.
 *
 * RAD-562 extends them to the request side: the client states the calendar it
 * wants months bucketed in, so the chart and the CSV export agree for a reader
 * outside the API's assumed zone.
 */

import { readFileSync } from "node:fs";

const failures: string[] = [];

function read(path: string) {
  return readFileSync(path, "utf8");
}

function expectPattern(source: string, pattern: RegExp, message: string) {
  if (!pattern.test(source)) failures.push(message);
}

function expectNoPattern(source: string, pattern: RegExp, message: string) {
  if (pattern.test(source)) failures.push(message);
}

const report = read("components/reports/reports/CashflowReport.tsx");

expectPattern(
  report,
  /buildCashflowSeries\(\s*data\?\.data\s*,/,
  "CashflowReport must rebuild the series with buildCashflowSeries instead of plotting the raw API rows.",
);
expectPattern(
  report,
  /fromDate:\s*filters\.fromDate[\s\S]{0,80}toDate:\s*filters\.toDate/,
  "CashflowReport must pass the selected period into the series builder so out-of-period months can be dropped.",
);
expectNoPattern(
  report,
  /data\?\.data\s*\?\?\s*\[\]/,
  "CashflowReport must not fall back to the raw API rows as chart data.",
);
expectPattern(
  report,
  /connectNulls=\{false\}/,
  "CashflowReport must leave gaps for months with no data rather than bridging them.",
);
expectPattern(
  report,
  /provisionalKey="isPartial"/,
  "CashflowReport must mark provisional (month-to-date or range-clipped) points on the chart.",
);
expectPattern(
  report,
  /partial\.footnoteCurrent/,
  "CashflowReport must annotate the incomplete current month in words, not by marker alone.",
);
expectNoPattern(
  report,
  /annualis|annualiz|\*\s*12\b/,
  "The month-to-date figure must be shown as-is, never annualised.",
);

const series = read("lib/reports/cashflow-series.ts");

expectPattern(
  series,
  /income:\s*row\s*\?\s*row\.income\s*:\s*null/,
  "A month with no row must carry null, so it is never read as a genuine zero.",
);
expectPattern(
  series,
  /hasData:\s*row\s*!==\s*undefined/,
  "The series must record whether a month had data, so absence and a real zero stay distinguishable.",
);
expectPattern(
  series,
  /ordinal\s*<\s*periodStart\s*\|\|\s*ordinal\s*>\s*periodEnd/,
  "Months outside the selected period must be excluded from the series.",
);

/**
 * RAD-562 — the report request must name the calendar it wants months in.
 *
 * The API buckets in the caller's calendar and assumes `Europe/Lisbon` when the
 * request does not say (RAD-555). A Madrid reader picking August sends an
 * instant that is still July in Lisbon, so without a stated calendar the CSV
 * export carries an out-of-period sliver the chart quietly drops — the surface
 * disagreement RAD-555 set out to end.
 */
const filtersHook = read("components/reports/filters/useReportFilters.ts");
const viewerTimeZone = read("lib/reports/viewer-timezone.ts");

expectPattern(
  filtersHook,
  /resolveViewerTimeZone/,
  "The report filter envelope must state the viewer's calendar, not let the API assume one.",
);
expectPattern(
  filtersHook,
  /\.\.\.\(timezone\s*\?\s*\{\s*timezone\s*\}\s*:\s*\{\}\)/,
  "An unknown calendar must leave no timezone key at all: the API rejects a name it cannot resolve.",
);
expectNoPattern(
  filtersHook,
  /params\.(?:set|get|delete)\(\s*["'`]timezone/,
  "The viewer's calendar describes the device, not the report, so it must never travel in a shared URL.",
);
expectPattern(
  viewerTimeZone,
  /typeof\s+window\s*===\s*["']undefined["']\)\s*return\s+undefined/,
  "A server render must never send the container's time zone as if it were the viewer's.",
);
expectPattern(
  viewerTimeZone,
  /catch\s*\{\s*return\s+undefined;?\s*\}/,
  "A runtime whose Intl throws must fall back to omitting the filter, not crash the report.",
);

const reportComponents = [
  "BudgetVsActualReport",
  "CashflowReport",
  "NetWorthHistoryReport",
  "PortfolioPerformanceReport",
  "SankeyReport",
  "SpendingByCategoryReport",
];

for (const component of reportComponents) {
  const source = read(`components/reports/reports/${component}.tsx`);
  expectPattern(
    source,
    /\{\s*\.\.\.filters,\s*format:\s*"csv"\s*\}/,
    `${component} must export with the same filter envelope it charts, so the two agree.`,
  );
}

const chartBase = read("components/ui/charts/composed-area-bar-chart-base.tsx");

expectPattern(
  chartBase,
  /connectNulls\s*=\s*false/,
  "The composed chart base must default to leaving gaps at nulls.",
);
expectPattern(
  chartBase,
  /connectNulls=\{connectNulls\}[\s\S]*connectNulls=\{connectNulls\}/,
  "Both the area and the line layers must honour the connectNulls setting.",
);

const localeCopyKeys = [
  "monthToDate",
  "partialMonth",
  "footnoteCurrent",
  "footnoteRange",
];

for (const locale of ["en", "pt", "es"]) {
  const messages = JSON.parse(read(`messages/${locale}/reports.json`)) as {
    reports?: {
      reports?: { cashflow?: { partial?: Record<string, string> } };
    };
  };
  const partial = messages.reports?.reports?.cashflow?.partial;

  if (!partial) {
    failures.push(
      `messages/${locale}/reports.json is missing reports.reports.cashflow.partial`,
    );
    continue;
  }

  for (const key of localeCopyKeys) {
    if (!partial[key]?.trim()) {
      failures.push(
        `messages/${locale}/reports.json is missing cash flow partial-month copy: ${key}`,
      );
    }
  }

  for (const key of ["footnoteCurrent", "footnoteRange"]) {
    if (partial[key] && !partial[key].includes("{month}")) {
      failures.push(
        `messages/${locale}/reports.json cashflow partial.${key} must name the month via {month}`,
      );
    }
  }
}

if (failures.length > 0) {
  console.error("Reports cash flow regression checks failed:\n");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Reports cash flow regression checks passed");
