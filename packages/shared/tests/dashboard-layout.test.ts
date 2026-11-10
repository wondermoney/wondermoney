import { describe, expect, it } from 'vitest';

import {
  DASHBOARD_SECTION_IDS,
  defaultDashboardLayout,
  mergeDashboardLayout,
  moveDashboardSection,
  setDashboardSectionHidden,
  type DashboardLayoutEntry,
} from '../lib/dashboard-layout';

const ids = (layout: readonly DashboardLayoutEntry[]) => layout.map((entry) => entry.id);
const visible = (layout: readonly DashboardLayoutEntry[]) =>
  layout.filter((entry) => !entry.hidden).map((entry) => entry.id);

describe('mergeDashboardLayout', () => {
  it('renders every section, visible, in the default order when nothing is saved', () => {
    expect(mergeDashboardLayout()).toEqual(defaultDashboardLayout());
    expect(mergeDashboardLayout([])).toEqual(defaultDashboardLayout());
    expect(mergeDashboardLayout(null)).toEqual(defaultDashboardLayout());
  });

  it('keeps the saved order and visibility', () => {
    const merged = mergeDashboardLayout([
      { id: 'net-worth', hidden: false },
      { id: 'loans', hidden: false },
      { id: 'this-month', hidden: true },
      { id: 'latest-transactions', hidden: false },
      { id: 'balance-sheet', hidden: true },
      { id: 'cashflow', hidden: false },
    ]);

    expect(ids(merged)).toEqual([
      'net-worth',
      'loans',
      'this-month',
      'latest-transactions',
      'balance-sheet',
      'cashflow',
    ]);
    expect(visible(merged)).toEqual(['net-worth', 'loans', 'latest-transactions', 'cashflow']);
  });

  it('drops ids this release cannot render', () => {
    const merged = mergeDashboardLayout([
      { id: 'net-worth', hidden: false },
      { id: 'insights', hidden: false },
      { id: 'review-status', hidden: true },
      { id: 'cashflow', hidden: false },
    ]);

    expect(ids(merged)).toEqual([
      'net-worth',
      'cashflow',
      'this-month',
      'balance-sheet',
      'loans',
      'latest-transactions',
    ]);
  });

  it('appends sections missing from a saved layout, visible', () => {
    const merged = mergeDashboardLayout([
      { id: 'net-worth', hidden: false },
      { id: 'cashflow', hidden: true },
    ]);

    expect(ids(merged)).toEqual([
      'net-worth',
      'cashflow',
      'this-month',
      'balance-sheet',
      'loans',
      'latest-transactions',
    ]);
    expect(merged.find((entry) => entry.id === 'this-month')?.hidden).toBe(false);
  });

  it('keeps the first of a duplicated id', () => {
    const merged = mergeDashboardLayout([
      { id: 'net-worth', hidden: false },
      { id: 'loans', hidden: true },
      { id: 'cashflow', hidden: false },
      { id: 'loans', hidden: false },
    ]);

    expect(ids(merged)).toEqual([
      'net-worth',
      'loans',
      'cashflow',
      'this-month',
      'balance-sheet',
      'latest-transactions',
    ]);
    expect(merged.find((entry) => entry.id === 'loans')?.hidden).toBe(true);
  });

  it('keeps net worth first and visible even when the saved layout disagrees', () => {
    const merged = mergeDashboardLayout([
      { id: 'cashflow', hidden: false },
      { id: 'net-worth', hidden: true },
    ]);

    expect(merged[0]).toEqual({ id: 'net-worth', hidden: false });
  });

  it('treats a non-boolean hidden flag as visible', () => {
    const merged = mergeDashboardLayout([
      { id: 'net-worth', hidden: false },
      { id: 'loans', hidden: 'yes' as unknown as boolean },
    ]);

    expect(merged.find((entry) => entry.id === 'loans')?.hidden).toBe(false);
  });

  it('covers every shipped section id', () => {
    expect(ids(defaultDashboardLayout())).toEqual([...DASHBOARD_SECTION_IDS]);
  });
});

describe('moveDashboardSection', () => {
  it('moves a section one place up or down', () => {
    const layout = defaultDashboardLayout();

    expect(ids(moveDashboardSection(layout, 'cashflow', 'up'))).toEqual([
      'net-worth',
      'this-month',
      'cashflow',
      'balance-sheet',
      'loans',
      'latest-transactions',
    ]);
    expect(ids(moveDashboardSection(layout, 'this-month', 'down'))).toEqual([
      'net-worth',
      'balance-sheet',
      'this-month',
      'cashflow',
      'loans',
      'latest-transactions',
    ]);
  });

  it('refuses to move net worth, or any section above it', () => {
    const layout = defaultDashboardLayout();

    expect(ids(moveDashboardSection(layout, 'net-worth', 'down'))).toEqual(ids(layout));
    expect(ids(moveDashboardSection(layout, 'this-month', 'up'))).toEqual(ids(layout));
  });

  it('does nothing at the ends or for an unknown id', () => {
    const layout = defaultDashboardLayout();

    expect(ids(moveDashboardSection(layout, 'latest-transactions', 'down'))).toEqual(ids(layout));
    expect(ids(moveDashboardSection(layout, 'insights', 'up'))).toEqual(ids(layout));
  });
});

describe('setDashboardSectionHidden', () => {
  it('hides and shows a section', () => {
    const hidden = setDashboardSectionHidden(defaultDashboardLayout(), 'loans', true);
    expect(hidden.find((entry) => entry.id === 'loans')?.hidden).toBe(true);

    const shown = setDashboardSectionHidden(hidden, 'loans', false);
    expect(shown.find((entry) => entry.id === 'loans')?.hidden).toBe(false);
  });

  it('never hides net worth', () => {
    const layout = setDashboardSectionHidden(defaultDashboardLayout(), 'net-worth', true);
    expect(layout.find((entry) => entry.id === 'net-worth')?.hidden).toBe(false);
  });
});
