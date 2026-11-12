import { describe, expect, it } from 'vitest';

import { canDecide, commitOutcome, countRows, defaultDecision, isMappingComplete, matchReason, unmappedSourceAccounts } from '../lib/import/review';
import type { ImportRowStatus } from '../lib/import/types';

/*
 * The rules the review applies to staged rows: what imports by default, what the person may
 * change, when a file with several accounts is mapped, and how a finished commit reads.
 */
describe('import review rules', () => {
  it.each<[ImportRowStatus, 'import' | 'skip' | null]>([
    ['new', 'import'],
    ['duplicate', 'skip'],
    ['possible_duplicate', 'skip'],
    ['invalid', null],
  ])('a %s row defaults to %s', (status, decision) => {
    expect(defaultDecision(status)).toBe(decision);
  });

  it('lets the person decide on new and duplicate rows, never on unreadable or finished ones', () => {
    expect(canDecide('new')).toBe(true);
    expect(canDecide('duplicate')).toBe(true);
    expect(canDecide('possible_duplicate')).toBe(true);
    expect(canDecide('invalid')).toBe(false);
    expect(canDecide('imported')).toBe(false);
    expect(canDecide('failed')).toBe(false);
  });

  it.each<[ImportRowStatus, boolean, ReturnType<typeof matchReason>]>([
    ['duplicate', true, 'same_id'],
    ['duplicate', false, 'earlier_in_file'],
    ['possible_duplicate', true, 'likely'],
    ['possible_duplicate', false, 'ambiguous'],
    ['new', false, null],
    ['skipped', true, null],
  ])('explains a %s row (matched: %s) as %s', (status, matched, reason) => {
    expect(matchReason(status, matched)).toBe(reason);
  });

  it('counts every status, including the ones with no rows', () => {
    expect(countRows(['new', 'new', 'duplicate', 'invalid'])).toEqual({ duplicate: 1, failed: 0, imported: 0, invalid: 1, new: 2, possible_duplicate: 0, skipped: 0 });
  });

  describe('account mapping', () => {
    const sourceAccounts = [{ label: 'Checking', rowCount: 3 }, { label: 'Card', rowCount: 2 }];

    it('is complete when the file has no source accounts (a single-account statement)', () => {
      expect(isMappingComplete([], {})).toBe(true);
    });

    it('is complete only when every source account maps to an account', () => {
      expect(isMappingComplete(sourceAccounts, { Checking: 1 })).toBe(false);
      expect(unmappedSourceAccounts(sourceAccounts, { Checking: 1 })).toEqual(['Card']);
      expect(isMappingComplete(sourceAccounts, { Card: 2, Checking: 1 })).toBe(true);
    });
  });

  describe('commit outcome', () => {
    it('succeeds when nothing failed, including when everything was skipped', () => {
      expect(commitOutcome({ failed: 0, imported: 3 })).toBe('succeeded');
      expect(commitOutcome({ failed: 0, imported: 0 })).toBe('succeeded');
    });

    it('is partial when some rows imported and some failed', () => {
      expect(commitOutcome({ failed: 1, imported: 3 })).toBe('partial');
    });

    it('fails when every row it tried failed', () => {
      expect(commitOutcome({ failed: 2, imported: 0 })).toBe('failed');
    });
  });
});
