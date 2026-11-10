import { describe, expect, it } from 'vitest';

import {
  dashboardLayoutSchema,
  patchUserPreferencesSchema,
  userPreferencesSchema,
} from '../preferences';

describe('userPreferencesSchema', () => {
  it('defaults preview features off and the layout to the default order for an empty document', () => {
    expect(userPreferencesSchema.parse({})).toEqual({
      dashboardLayout: [],
      previewFeatures: false,
    });
  });

  it('keeps a stored boolean', () => {
    expect(userPreferencesSchema.parse({ previewFeatures: true })).toEqual({
      dashboardLayout: [],
      previewFeatures: true,
    });
  });

  it('keeps a stored layout in order', () => {
    const dashboardLayout = [
      { hidden: false, id: 'net-worth' },
      { hidden: true, id: 'loans' },
    ];

    expect(userPreferencesSchema.parse({ dashboardLayout }).dashboardLayout).toEqual(
      dashboardLayout,
    );
  });

  it('drops keys this release does not know', () => {
    expect(userPreferencesSchema.parse({ futureToggle: 'on', previewFeatures: true })).toEqual({
      dashboardLayout: [],
      previewFeatures: true,
    });
  });

  it('rejects a wrong type rather than coercing it', () => {
    expect(userPreferencesSchema.safeParse({ previewFeatures: 'yes' }).success).toBe(false);
    expect(userPreferencesSchema.safeParse({ previewFeatures: 1 }).success).toBe(false);
    expect(userPreferencesSchema.safeParse({ previewFeatures: null }).success).toBe(false);
  });
});

describe('dashboardLayoutSchema', () => {
  it('accepts an ordered list of section ids and hidden flags', () => {
    const layout = [
      { hidden: false, id: 'net-worth' },
      { hidden: true, id: 'cashflow' },
    ];

    expect(dashboardLayoutSchema.parse(layout)).toEqual(layout);
  });

  it('keeps ids this release does not render, so a newer client layout survives', () => {
    expect(dashboardLayoutSchema.parse([{ hidden: true, id: 'insights' }])).toEqual([
      { hidden: true, id: 'insights' },
    ]);
  });

  it('deduplicates ids, keeping the first entry', () => {
    expect(
      dashboardLayoutSchema.parse([
        { hidden: true, id: 'loans' },
        { hidden: false, id: 'cashflow' },
        { hidden: false, id: 'loans' },
      ]),
    ).toEqual([
      { hidden: true, id: 'loans' },
      { hidden: false, id: 'cashflow' },
    ]);
  });

  it('trims ids and rejects blank ones', () => {
    expect(dashboardLayoutSchema.parse([{ hidden: false, id: ' loans ' }])).toEqual([
      { hidden: false, id: 'loans' },
    ]);
    expect(dashboardLayoutSchema.safeParse([{ hidden: false, id: '   ' }]).success).toBe(false);
  });

  it('rejects a malformed entry rather than guessing', () => {
    expect(dashboardLayoutSchema.safeParse([{ id: 'loans' }]).success).toBe(false);
    expect(dashboardLayoutSchema.safeParse([{ hidden: 'yes', id: 'loans' }]).success).toBe(false);
    expect(dashboardLayoutSchema.safeParse([{ hidden: false }]).success).toBe(false);
    expect(dashboardLayoutSchema.safeParse('loans').success).toBe(false);
  });

  it('bounds the document', () => {
    const tooMany = Array.from({ length: 65 }, (_, index) => ({
      hidden: false,
      id: `section-${index}`,
    }));

    expect(dashboardLayoutSchema.safeParse(tooMany).success).toBe(false);
  });
});

describe('patchUserPreferencesSchema', () => {
  const parseBody = (body: Record<string, unknown>) => patchUserPreferencesSchema.safeParse({ body });

  it.each([true, false])('accepts previewFeatures: %s', (previewFeatures) => {
    const result = parseBody({ previewFeatures });

    expect(result.success).toBe(true);
    expect(result.data?.body).toEqual({ previewFeatures });
  });

  it('accepts a layout patch and deduplicates it', () => {
    const result = parseBody({
      dashboardLayout: [
        { hidden: false, id: 'net-worth' },
        { hidden: true, id: 'loans' },
        { hidden: false, id: 'loans' },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.data?.body).toEqual({
      dashboardLayout: [
        { hidden: false, id: 'net-worth' },
        { hidden: true, id: 'loans' },
      ],
    });
  });

  it('accepts an empty layout, which restores the default order', () => {
    const result = parseBody({ dashboardLayout: [] });

    expect(result.success).toBe(true);
    expect(result.data?.body).toEqual({ dashboardLayout: [] });
  });

  it('drops unknown keys from a patch instead of storing them', () => {
    const result = parseBody({ futureToggle: 'on', previewFeatures: true });

    expect(result.success).toBe(true);
    expect(result.data?.body).toEqual({ previewFeatures: true });
  });

  it('rejects a patch with no known preference', () => {
    expect(parseBody({}).success).toBe(false);
    expect(parseBody({ futureToggle: true }).success).toBe(false);
  });

  it('rejects a wrong type', () => {
    expect(parseBody({ previewFeatures: 'yes' }).success).toBe(false);
    expect(parseBody({ previewFeatures: 1 }).success).toBe(false);
    expect(parseBody({ dashboardLayout: [{ hidden: 1, id: 'loans' }] }).success).toBe(false);
  });
});
