import { describe, expect, it } from 'vitest';

import { hiddenTransactionCond } from '../filters/tenant-filter';

/**
 * RAD-25 — filter condition logic (DB-free), mirroring tenant-filter.test.ts.
 * Unlike the tenant filter, this one is unconditional: no household/tenant args,
 * no scope-when-present behavior. It always excludes hidden = true rows.
 */
describe('RAD-25 — hidden transaction filter condition', () => {
  it('unconditionally excludes hidden transactions', () => {
    expect(hiddenTransactionCond()).toEqual({ hidden: false });
  });
});
