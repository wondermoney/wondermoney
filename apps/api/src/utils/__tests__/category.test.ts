import { describe, expect, it } from 'vitest';

import { pickTextColorBasedOnBgColorAdvanced, pickTextColorBasedOnBgColorSimple } from '@utils/category';

describe('category color utils', () => {
  it('returns dark text for light backgrounds (advanced)', () => {
    expect(pickTextColorBasedOnBgColorAdvanced('#FFFFFF')).toBe('#171923');
    expect(pickTextColorBasedOnBgColorAdvanced('#fafafa')).toBe('#171923');
  });

  it('returns light text for dark backgrounds (advanced)', () => {
    expect(pickTextColorBasedOnBgColorAdvanced('#000000')).toBe('#F7FAFC');
  });

  it('returns dark text for light backgrounds (simple)', () => {
    expect(pickTextColorBasedOnBgColorSimple('#FFFFFF')).toBe('#171923');
  });

  it('returns light text for dark backgrounds (simple)', () => {
    expect(pickTextColorBasedOnBgColorSimple('#000000')).toBe('#F7FAFC');
  });
});

