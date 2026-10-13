/**
 * Guards the three things RAD-551 fixed on `/[locale]/budgets`.
 *
 * 1. **The heading outline.** The page opened with an `<h2>` and put an `<h6>`
 *    under it, so the one route in the product that lists more than one budget
 *    jumped two → six with no `<h1>` anywhere. This does not pattern-match the
 *    source for `h1`: it renders the page's real header primitives and reads
 *    the heading tags back out of the markup, because a heading level that is
 *    "obviously" right in JSX is exactly the kind of thing that is not.
 * 2. **The secondary line.** The wizard never asks for a name, so two budgets
 *    created in succession are both "My Budget". Each row carries a muted line
 *    of metadata that tells them apart, and every string on it is translated in
 *    all three locales.
 * 3. **The 0% progress bar.** An empty grey track carrying `0%` read as a
 *    divider. At zero the cell says what it knows in words instead.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";

import { PageHeader } from "../components/layout/PageHeader";
import { PageShell } from "../components/layout/PageShell";
import { SectionHeader } from "../components/layout/SectionHeader";

const root = process.cwd();

function read(relativePath: string) {
  return readFileSync(join(root, relativePath), "utf8");
}

// --- 1. the rendered heading outline ---------------------------------------

/**
 * The page body, assembled from the same primitives `budgets/page.tsx` uses.
 * The table and the card are data-only and contribute no headings, so the
 * outline this renders is the outline the route ships.
 */
const markup = renderToStaticMarkup(
  <PageShell>
    <PageHeader title="Budgets overview" description="…" />
    <section>
      <SectionHeader title="Budgets" actions={<button>Create budget</button>} />
    </section>
  </PageShell>,
);

const headingLevels = [...markup.matchAll(/<h([1-6])[\s>]/g)].map((match) =>
  Number(match[1]),
);

assert.deepEqual(
  headingLevels.filter((level) => level === 1).length,
  1,
  `the budgets overview must render exactly one <h1>; rendered levels were ${headingLevels.join(", ")}`,
);

assert.equal(
  headingLevels[0],
  1,
  `the first heading on the page must be the <h1>; rendered levels were ${headingLevels.join(", ")}`,
);

for (let i = 1; i < headingLevels.length; i++) {
  assert.ok(
    headingLevels[i] - headingLevels[i - 1] <= 1,
    `heading level jumped from h${headingLevels[i - 1]} to h${headingLevels[i]} — a level may not be skipped`,
  );
}

// The empty branch is a different component and needs its own single <h1>.
const emptyState = read("components/budget/BudgetsEmptyState.tsx");
assert.equal(
  (emptyState.match(/<h1[\s>]/g) ?? []).length,
  1,
  "BudgetsEmptyState must render exactly one <h1> — it replaces the whole page when there are no budgets",
);
assert.ok(
  !/<h[3-6][\s>]/.test(emptyState),
  "BudgetsEmptyState must not skip from its <h1> to an h3 or lower",
);

// --- 2. the page uses the shared header primitives --------------------------

const page = read("app/[locale]/(full-layout)/budgets/page.tsx");

for (const primitive of ["PageShell", "PageHeader", "SectionHeader"] as const) {
  assert.ok(
    page.includes(`import { ${primitive} } from "@/components/layout/${primitive}"`),
    `budgets/page.tsx must import ${primitive} rather than hand-rolling a heading`,
  );
}

assert.ok(
  !/<Heading\b/.test(page),
  "budgets/page.tsx must not go back to <Heading variant=…> — that is how it ended up with an h2 over an h6",
);

// --- 3. the row's secondary line and the zero-progress state ----------------

const table = read("components/budget/BudgetsTable.tsx");

assert.ok(
  /rowMetadata\[row\.index\]/.test(table),
  "the name cell must render the secondary metadata line — without it two budgets named the same are the same row twice",
);

/**
 * RAD-569 — the same three states on both tables.
 *
 * `/budgets` and the dashboard render the same rows from the same data with two
 * separate components, and RAD-551's acceptance was scoped to the route, so the
 * dashboard kept the 0% bar for another release. Asserting both here rather
 * than adding a second guard is what stops them drifting apart again.
 */
const PROGRESS_SURFACES = [
  ["components/budget/BudgetsTable.tsx", table],
  [
    "components/dashboard/DashboardBudgetsTable.tsx",
    read("components/dashboard/DashboardBudgetsTable.tsx"),
  ],
] as const;

for (const [path, source] of PROGRESS_SURFACES) {
  assert.ok(
    /budget-row-nothing-spent/.test(source) && /totalSpent === 0/.test(source),
    `${path}: the progress cell must replace the empty track with a worded state when nothing has been spent`,
  );

  assert.ok(
    /budget-row-nothing-budgeted/.test(source) &&
      /totalBudgeted <= 0/.test(source),
    `${path}: a budget with nothing budgeted must say so rather than render a 0% bar it cannot honestly compute`,
  );

  assert.ok(
    /isOverBudget \? \(\s*<span className="sr-only">/.test(source),
    `${path}: over budget must carry a non-colour cue, not just the destructive bar fill`,
  );

  assert.ok(
    /<Progress\s+aria-hidden="true"/.test(source),
    `${path}: the bar restates the adjacent percentage, so it must not also be announced as an unnamed progressbar`,
  );
}

// The dashboard renders a separate mobile list from the same rows; it carries
// the same bar and needs the same states.
const dashboardTable = read(
  "components/dashboard/DashboardBudgetsTable.tsx",
);
assert.ok(
  (dashboardTable.match(/budget-row-nothing-budgeted/g) ?? []).length >= 2,
  "the dashboard's mobile list and its table must both handle the nothing-budgeted state",
);

// --- 4. every string on the row exists in all three locales -----------------

const requiredKeys = [
  "budget-row-income-summary",
  "budget-row-category-count",
  "budget-row-account-count",
  "budget-row-identifier",
  "budget-row-nothing-spent",
  "budget-row-nothing-budgeted",
] as const;

for (const locale of ["en", "pt", "es"] as const) {
  const messages = JSON.parse(read(`messages/${locale}/common.json`)) as Record<
    string,
    unknown
  >;

  for (const key of requiredKeys) {
    const value = messages[key];
    assert.ok(
      typeof value === "string" && value.trim() !== "",
      `messages/${locale}/common.json is missing ${key}`,
    );
  }

  // `over-budget` is the sr-only cue on an over-budget row.
  assert.ok(
    typeof messages["over-budget"] === "string",
    `messages/${locale}/common.json is missing over-budget`,
  );

  const countKeys = ["budget-row-category-count", "budget-row-account-count"] as const;
  for (const key of countKeys) {
    assert.match(
      messages[key] as string,
      /\{count, plural,/,
      `${locale}.${key} must be an ICU plural — "1 categories" is a bug in every locale`,
    );
  }
}

console.log("Budgets overview regression checks passed");
