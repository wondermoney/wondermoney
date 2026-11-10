/**
 * The home dashboard's section order and visibility, shared by web and mobile.
 *
 * The server stores only what the person arranged (`dashboardLayout` in the
 * per-user preferences document), never the rendered list: an empty list means
 * the default order. `mergeDashboardLayout` turns whatever a client reads into
 * the list it should render, so a section added in a later release appears at
 * the end, visible, for everyone who saved a layout before it existed.
 *
 * Ids are stable strings, not an enum of what this release renders: a layout
 * saved by a newer client keeps its unknown ids, and this module ignores them
 * until the section exists here. `insights` and `review-status` are reserved
 * for the sections that will follow.
 *
 * This module has no dependencies so web and mobile can import it directly
 * (`@wondermoney/shared/dashboard-layout`).
 */

/** Every section this release can render, in the default order. */
export const DASHBOARD_SECTION_IDS = [
  'net-worth',
  'this-month',
  'balance-sheet',
  'cashflow',
  'loans',
  'latest-transactions',
] as const;

export type DashboardSectionId = (typeof DASHBOARD_SECTION_IDS)[number];

/** Net worth leads the page and is the one section a person cannot hide or move. */
export const PINNED_DASHBOARD_SECTION_ID = 'net-worth' satisfies DashboardSectionId;

/**
 * One entry of the stored layout. `id` is a plain string, not
 * `DashboardSectionId`, so a document written by a newer client survives this
 * one; unknown ids are ignored when the layout is merged.
 */
export interface DashboardLayoutEntry {
  id: string;
  hidden: boolean;
}

export type DashboardSectionMove = 'up' | 'down';

const knownSectionIds: ReadonlySet<string> = new Set(DASHBOARD_SECTION_IDS);

export function isDashboardSectionId(id: string): id is DashboardSectionId {
  return knownSectionIds.has(id);
}

/** The default layout: every section, in the order the product ships. */
export function defaultDashboardLayout(): DashboardLayoutEntry[] {
  return DASHBOARD_SECTION_IDS.map((id) => ({ id, hidden: false }));
}

/**
 * The layout to render, from whatever the server holds.
 *
 * - Unknown ids are dropped (a section this release cannot render).
 * - Duplicate ids keep their first entry, so the order is deterministic.
 * - Sections missing from the saved list are appended, visible, in the default
 *   order — this is how a new section reaches someone with a saved layout.
 * - Net worth is always first and always visible, whatever the saved document
 *   says.
 */
export function mergeDashboardLayout(
  saved?: readonly DashboardLayoutEntry[] | null,
): DashboardLayoutEntry[] {
  const merged: DashboardLayoutEntry[] = [];
  const seen = new Set<string>();

  for (const entry of saved ?? []) {
    const id = entry.id;
    if (id === PINNED_DASHBOARD_SECTION_ID) continue;
    if (!isDashboardSectionId(id) || seen.has(id)) continue;
    seen.add(id);
    merged.push({ id, hidden: entry.hidden === true });
  }

  const pinned: DashboardLayoutEntry = {
    id: PINNED_DASHBOARD_SECTION_ID,
    hidden: false,
  };

  for (const id of DASHBOARD_SECTION_IDS) {
    if (id === PINNED_DASHBOARD_SECTION_ID || seen.has(id)) continue;
    merged.push({ id, hidden: false });
  }

  return [pinned, ...merged];
}

/**
 * Move one section one place up or down. Net worth never moves, and no section
 * can move above it. An unknown id, a pinned id, or a move past either end
 * returns the layout unchanged.
 */
export function moveDashboardSection(
  layout: readonly DashboardLayoutEntry[],
  id: string,
  direction: DashboardSectionMove,
): DashboardLayoutEntry[] {
  const index = layout.findIndex((entry) => entry.id === id);
  if (index < 0 || id === PINNED_DASHBOARD_SECTION_ID) return [...layout];

  const target = direction === 'up' ? index - 1 : index + 1;
  // Index 0 is the pinned section, so "up" from index 1 is already the top.
  if (target < 1 || target >= layout.length) return [...layout];

  const next = [...layout];
  const moved = next[index];
  const displaced = next[target];
  if (!moved || !displaced) return next;
  next[index] = displaced;
  next[target] = moved;
  return next;
}

/**
 * Show or hide one section. Net worth cannot be hidden; an unknown id is
 * ignored. Returns a new list either way, so a caller can always commit the
 * result.
 */
export function setDashboardSectionHidden(
  layout: readonly DashboardLayoutEntry[],
  id: string,
  hidden: boolean,
): DashboardLayoutEntry[] {
  if (id === PINNED_DASHBOARD_SECTION_ID) return [...layout];
  return layout.map((entry) =>
    entry.id === id ? { id: entry.id, hidden } : { id: entry.id, hidden: entry.hidden },
  );
}
