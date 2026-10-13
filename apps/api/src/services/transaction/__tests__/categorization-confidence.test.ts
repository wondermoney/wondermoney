import { describe, expect, it } from 'vitest';

import { CategorizationConfidence } from '@entity/Transaction';

import { applyCategorizationOutcome, categorizationConfidenceFor, markUserCategorized } from '../categorization-confidence';

describe('categorizationConfidenceFor', () => {
  it('maps reasons to tiers', () => {
    expect(categorizationConfidenceFor('user_edit')).toBe(CategorizationConfidence.HIGH);
    expect(categorizationConfidenceFor('user_mapping')).toBe(CategorizationConfidence.HIGH);
    expect(categorizationConfidenceFor('stats_default')).toBe(CategorizationConfidence.MEDIUM);
    expect(categorizationConfidenceFor('stats_top_count')).toBe(CategorizationConfidence.MEDIUM);
    expect(categorizationConfidenceFor('merchant_ambiguous')).toBe(CategorizationConfidence.LOW);
    expect(categorizationConfidenceFor('stats_tie')).toBe(CategorizationConfidence.LOW);
    expect(categorizationConfidenceFor('category_invalid')).toBe(CategorizationConfidence.LOW);
    expect(categorizationConfidenceFor('merchant_no_mapping')).toBe(CategorizationConfidence.NONE);
    expect(categorizationConfidenceFor('unsafe_text')).toBe(CategorizationConfidence.NONE);
  });

  it('returns null for no-op reasons (leave existing confidence untouched)', () => {
    for (const reason of ['disabled', 'already_categorized', 'duplicate', 'duplicate-assignment'] as const) {
      expect(categorizationConfidenceFor(reason)).toBeNull();
    }
  });
});

describe('applyCategorizationOutcome', () => {
  it('sets fields and auto-clears review for high confidence', () => {
    const t = { reviewed: false } as { categorizationConfidence?: CategorizationConfidence; categorizationReason?: string; reviewed: boolean };
    applyCategorizationOutcome(t, 'user_mapping');
    expect(t).toMatchObject({ categorizationConfidence: CategorizationConfidence.HIGH, categorizationReason: 'user_mapping', reviewed: true });
  });

  it('sets fields but leaves reviewed untouched for non-high', () => {
    const t = { reviewed: false } as { categorizationConfidence?: CategorizationConfidence; categorizationReason?: string; reviewed: boolean };
    applyCategorizationOutcome(t, 'stats_top_count');
    expect(t).toMatchObject({ categorizationConfidence: CategorizationConfidence.MEDIUM, categorizationReason: 'stats_top_count', reviewed: false });
  });

  it('writes nothing for a no-op reason', () => {
    const t = { reviewed: false } as { categorizationConfidence?: CategorizationConfidence; categorizationReason?: string; reviewed: boolean };
    applyCategorizationOutcome(t, 'already_categorized');
    expect(t.categorizationConfidence).toBeUndefined();
    expect(t.categorizationReason).toBeUndefined();
    expect(t.reviewed).toBe(false);
  });
});

describe('markUserCategorized', () => {
  it('stamps high/user_edit and leaves reviewed untouched', () => {
    const t = { reviewed: false } as { categorizationConfidence?: CategorizationConfidence; categorizationReason?: string; reviewed: boolean };
    markUserCategorized(t);
    expect(t).toMatchObject({ categorizationConfidence: CategorizationConfidence.HIGH, categorizationReason: 'user_edit' });
    expect(t.reviewed).toBe(false);
  });
});
