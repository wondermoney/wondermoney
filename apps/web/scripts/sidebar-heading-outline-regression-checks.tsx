/**
 * Guards the shell-wide heading outline fixed by RAD-557.
 *
 * The desktop rail rendered its three group labels ("Day-to-day",
 * "Investments", "Planning") as `<h2>`s. The chrome renders before the page in
 * `app/[locale]/(full-layout)/layout.tsx`, so in raw DOM order every
 * authenticated route read `h2 (nav group) → h1 (page) → h2 (section)`: a
 * screen reader's heading list opened inside the navigation and the page title
 * turned up partway down.
 *
 * Nav group labels are landmark structure, not document structure, so they no
 * longer take a heading level. They stay visible and stay announced by naming
 * their own `<ul>` through `aria-labelledby`.
 *
 * This does not pattern-match JSX for the fix. It renders the real group
 * component and reads tags and ARIA back out of the markup, because "this
 * obviously isn't a heading any more" is exactly the kind of thing that is.
 * The source scans below only cover the parts of the shell that cannot be
 * rendered here without a Next router, a Supabase client and a query client —
 * for those, the invariant is "no heading tag at all", which source is enough
 * to establish.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";

import { PageHeader } from "../components/layout/PageHeader";
import { PageShell } from "../components/layout/PageShell";
import { SectionHeader } from "../components/layout/SectionHeader";
import { SidebarNavGroup } from "../components/layout/SidebarNavGroup";

const root = process.cwd();

function read(relativePath: string) {
  return readFileSync(join(root, relativePath), "utf8");
}

/**
 * Comments talk *about* the `<h2>` this ticket removed, so the source scans
 * below read code only.
 */
function stripComments(source: string) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

function headingLevelsIn(markup: string) {
  return [...markup.matchAll(/<h([1-6])[\s>]/g)].map((match) =>
    Number(match[1]),
  );
}

/** The three groups the rail ships, in render order. */
const groups = [
  { id: "day-to-day", label: "Day-to-day" },
  { id: "investments", label: "Investments" },
  { id: "planning", label: "Planning" },
] as const;

// --- 1. the rail emits no headings -----------------------------------------

const railMarkup = renderToStaticMarkup(
  <>
    {groups.map((group) => (
      <SidebarNavGroup key={group.id} id={group.id} label={group.label}>
        <li>
          <a href={`/${group.id}`}>A destination</a>
        </li>
      </SidebarNavGroup>
    ))}
  </>,
);

assert.deepEqual(
  headingLevelsIn(railMarkup),
  [],
  `the sidebar nav groups must render no heading at all — rendered levels were ${headingLevelsIn(railMarkup).join(", ")}`,
);

// --- 2. every group is still a named region --------------------------------

for (const group of groups) {
  const labelId = `sidebar-nav-group-${group.id}`;

  assert.match(
    railMarkup,
    new RegExp(`<[a-z]+[^>]*\\bid="${labelId}"[^>]*>${group.label}<`),
    `the visible label for "${group.label}" must carry id="${labelId}" so it can name the group`,
  );

  assert.match(
    railMarkup,
    new RegExp(`<ul[^>]*\\baria-labelledby="${labelId}"`),
    `the "${group.label}" list must be named by its visible label — dropping the <h2> must not drop the group's accessible name`,
  );
}

// The label is still styled exactly as it was as an `<h2>`; a "fix" that also
// hid or restyled it is not the fix.
assert.match(
  railMarkup,
  /text-\[0\.6875rem\] font-semibold tracking-wider uppercase/,
  "the group label must keep its visual styling",
);
assert.doesNotMatch(
  railMarkup,
  /sr-only/,
  "the group label must stay visible, not be hidden behind a screen-reader-only name",
);

// --- 3. shell then page: the document opens on the page <h1> ---------------

/**
 * Source order of an authenticated route: `FullLayoutClientChrome` (the rail
 * and the bottom bar), then `<Container>{children}</Container>`. This composes
 * the same order and asserts on the outline it produces.
 */
const documentMarkup = renderToStaticMarkup(
  <>
    <nav aria-label="Main navigation">
      {groups.map((group) => (
        <SidebarNavGroup key={group.id} id={group.id} label={group.label}>
          <li>
            <a href={`/${group.id}`}>A destination</a>
          </li>
        </SidebarNavGroup>
      ))}
    </nav>
    <main>
      <PageShell>
        <PageHeader title="A page title" description="…" />
        <section>
          <SectionHeader title="A section" />
        </section>
      </PageShell>
    </main>
  </>,
);

const documentLevels = headingLevelsIn(documentMarkup);

assert.equal(
  documentLevels[0],
  1,
  `the first heading in the document must be the page <h1>; rendered levels were ${documentLevels.join(", ")}`,
);

assert.equal(
  documentLevels.filter((level) => level === 1).length,
  1,
  `an authenticated route must render exactly one <h1>; rendered levels were ${documentLevels.join(", ")}`,
);

for (let i = 1; i < documentLevels.length; i++) {
  assert.ok(
    documentLevels[i] - documentLevels[i - 1] <= 1,
    `heading level jumped from h${documentLevels[i - 1]} to h${documentLevels[i]} — a level may not be skipped`,
  );
}

// --- 4. no other part of the shell sneaks a heading in ---------------------

/**
 * Everything `FullLayoutClientChrome` mounts before the page, plus the
 * components those mount inline. Overlay content (dialogs, sheets, drawers) is
 * portalled and only exists while open, and a dialog is *supposed* to have a
 * title, so `DialogTitle`/`SheetTitle` are deliberately not covered here.
 */
const shellSources = [
  "app/[locale]/(full-layout)/FullLayoutClientChrome.tsx",
  "components/layout/Sidebar.tsx",
  "components/layout/SidebarNavGroup.tsx",
  "components/layout/BottomNav.tsx",
  "components/layout/BottomNavMoreSheet.tsx",
  "components/layout/Logo.tsx",
  "components/layout/Feedback.tsx",
] as const;

for (const file of shellSources) {
  const source = stripComments(read(file));

  assert.ok(
    !/<h[1-6][\s>]/.test(source),
    `${file} renders inside the shell, before page content — it must not emit a heading tag`,
  );

  assert.ok(
    !/variant="h[1-6]"/.test(source),
    `${file} must not use a Typography h1–h6 variant — it maps straight to a heading tag`,
  );
}

// --- 4b. every authenticated route opens on an h1 and skips no level -------

/**
 * RAD-566 — the per-route half.
 *
 * RAD-557 removed the nav `<h2>`s, which made each route's outline start at its
 * own first heading and exposed two routes that never had an `<h1>`: `/settings`
 * and `/financial-markets/explorer`. Both had been leaning on the nav heading to
 * open their outline.
 *
 * The route bodies cannot be rendered here — they need a Next router, a Supabase
 * client and a query client — so this asserts the two things source can settle:
 * the page renders the primitive that owns the `<h1>`, and no file in the route
 * emits a heading tag that would skip a level under it.
 */
const ROUTES_WITH_PAGE_HEADER = [
  "app/[locale]/(full-layout)/settings/page.tsx",
  "app/[locale]/(full-layout)/financial-markets/explorer/explorer-client.tsx",
  "app/[locale]/(full-layout)/home-client.tsx",
  "app/[locale]/(full-layout)/reports/page.tsx",
  "app/[locale]/(full-layout)/budgets/page.tsx",
] as const;

for (const file of ROUTES_WITH_PAGE_HEADER) {
  const source = stripComments(read(file));

  assert.match(
    source,
    /<PageHeader\b/,
    `${file} must render <PageHeader> — it is what puts the single <h1> on the route`,
  );

  assert.ok(
    !/<h1[\s>]|variant="h1"/.test(source),
    `${file} must let PageHeader own the <h1> rather than rendering a second one`,
  );
}

/**
 * The dashboard's own outline. `/` read h1 → **h3** → h2 → h2 → **h6**: the net
 * worth block opened at h3 directly under the page h1, and the budgets empty
 * state used `variant="h6"`, which maps straight to an `<h6>` tag, three levels
 * below the section h2 it sits under.
 */
const DASHBOARD_SECTIONS = [
  "components/dashboard/DashboardNetWorthBlock.tsx",
  "components/dashboard/DashboardGoalsCard.tsx",
  "components/dashboard/ReferralCard.tsx",
] as const;

for (const file of DASHBOARD_SECTIONS) {
  const source = stripComments(read(file));

  assert.ok(
    !/<h[3-6][\s>]|variant="h[3-6]"/.test(source),
    `${file} is a top-level dashboard section sitting directly under the page <h1> — it must open at h2, not skip to h3 or lower`,
  );
}

// Rendered inside the budgets section, below its SectionHeader h2.
const budgetsEmptyState = stripComments(
  read("components/dashboard/DashboardBudgetsEmptyState.tsx"),
);
assert.ok(
  !/<h[4-6][\s>]|variant="h[4-6]"/.test(budgetsEmptyState),
  "DashboardBudgetsEmptyState sits under the budgets section h2, so its heading is an h3 — variant=\"h6\" maps straight to an <h6> and skips three levels",
);
assert.match(
  budgetsEmptyState,
  /<h3[\s>]/,
  "DashboardBudgetsEmptyState must carry its h3 — without a heading the empty state contributes nothing to the outline",
);

// --- 4c. CardTitle stays a div, on purpose ---------------------------------

/**
 * A card is a container, not a document section, so `CardTitle` renders a
 * `<div>` and no card anywhere contributes to the outline. That is a decision,
 * not an oversight — asserted so a later "cards should be headings" change is a
 * conversation rather than a silent flood of outline entries. The reasoning is
 * on the component.
 */
const card = read("components/ui/card.tsx");
assert.match(
  card,
  /RAD-566 — deliberately a `<div>`, not a heading/,
  "the reasoning for CardTitle not being a heading must stay on the component",
);
assert.ok(
  !/<h[1-6][\s>]/.test(stripComments(card)),
  "CardTitle must stay a div — promoting it makes every card in the app an outline entry",
);

// --- 5. both navigation landmarks are named --------------------------------

const sidebar = read("components/layout/Sidebar.tsx");
const bottomNav = read("components/layout/BottomNav.tsx");

assert.match(
  sidebar,
  /<nav\s+aria-label=\{t\("navigation\.sidebar-nav"\)\}/,
  'the desktop rail\'s <nav> must be named — with the group <h2>s gone it is the landmark that carries "this is the navigation"',
);

assert.match(
  bottomNav,
  /aria-label=\{t\("navigation\.bottom-nav"\)\}/,
  "the mobile bottom bar's <nav> must stay named",
);

assert.match(
  sidebar,
  /<SidebarNavGroup\b/,
  "Sidebar must render its groups through SidebarNavGroup rather than hand-rolling the label again",
);

// --- 6. the landmark names exist in all three locales ----------------------

for (const locale of ["en", "pt", "es"] as const) {
  const messages = JSON.parse(read(`messages/${locale}/navigation.json`)) as {
    navigation: Record<string, unknown>;
  };

  for (const key of ["sidebar-nav", "bottom-nav"] as const) {
    const value = messages.navigation[key];
    assert.ok(
      typeof value === "string" && value.trim() !== "",
      `messages/${locale}/navigation.json is missing navigation.${key}`,
    );
  }

  for (const key of [
    "group-day-to-day",
    "group-investments",
    "group-planning",
  ] as const) {
    const value = messages.navigation[key];
    assert.ok(
      typeof value === "string" && value.trim() !== "",
      `messages/${locale}/navigation.json is missing navigation.${key} — the group's accessible name comes from this string`,
    );
  }
}

console.log("Sidebar heading outline regression checks passed");
