import { describe, expect, it } from 'vitest';

import { PortfolioImportAssetGroup, PortfolioImportAssetGroupStatus } from '@entity/PortfolioImportAssetGroup';
import { PortfolioImportRow, PortfolioImportRowStatus } from '@entity/PortfolioImportRow';
import { PortfolioImportSessionStatus } from '@entity/PortfolioImportSession';

import {
  buildImportSessionSummary,
  canConfirm,
  recomputeImportSessionStatus,
  terminalKind,
  toTerminalKind,
} from '../portfolio-import-session-state';

function group(status: PortfolioImportAssetGroupStatus): PortfolioImportAssetGroup {
  return { status } as PortfolioImportAssetGroup;
}

function row(status: PortfolioImportRowStatus): PortfolioImportRow {
  return { status } as PortfolioImportRow;
}

describe('portfolio import session state', () => {
  describe('buildImportSessionSummary', () => {
    it('counts rows by status and groups by status', () => {
      const summary = buildImportSessionSummary(
        [
          row(PortfolioImportRowStatus.READY),
          row(PortfolioImportRowStatus.READY),
          row(PortfolioImportRowStatus.DUPLICATE),
          row(PortfolioImportRowStatus.INVALID),
          row(PortfolioImportRowStatus.NEEDS_ASSET_REVIEW),
          row(PortfolioImportRowStatus.SKIPPED),
        ],
        [
          group(PortfolioImportAssetGroupStatus.AMBIGUOUS),
          group(PortfolioImportAssetGroupStatus.MATCHED),
          group(PortfolioImportAssetGroupStatus.PROVIDER_ERROR),
          group(PortfolioImportAssetGroupStatus.SELECTED),
          group(PortfolioImportAssetGroupStatus.SKIPPED),
          group(PortfolioImportAssetGroupStatus.UNMATCHED),
        ],
      );

      expect(summary).toEqual({
        assetGroups: {
          ambiguousGroups: 1,
          matchedGroups: 1,
          providerErrorGroups: 1,
          selectedGroups: 1,
          skippedGroups: 1,
          totalGroups: 6,
          unmatchedGroups: 1,
        },
        duplicateRows: 1,
        invalidRows: 1,
        needsAssetReviewRows: 1,
        readyRows: 2,
        skippedRows: 1,
        totalRows: 6,
      });
    });

    it('returns zeroed counts for empty input', () => {
      const summary = buildImportSessionSummary([], []);
      expect(summary.totalRows).toBe(0);
      expect(summary.readyRows).toBe(0);
      expect(summary.assetGroups.totalGroups).toBe(0);
    });
  });

  describe('recomputeImportSessionStatus', () => {
    it('returns needs_asset_review when any group is blocking', () => {
      expect(recomputeImportSessionStatus([row(PortfolioImportRowStatus.READY)], [group(PortfolioImportAssetGroupStatus.AMBIGUOUS)]))
        .toBe(PortfolioImportSessionStatus.NEEDS_ASSET_REVIEW);
      expect(recomputeImportSessionStatus([row(PortfolioImportRowStatus.READY)], [group(PortfolioImportAssetGroupStatus.PROVIDER_ERROR)]))
        .toBe(PortfolioImportSessionStatus.NEEDS_ASSET_REVIEW);
      expect(recomputeImportSessionStatus([row(PortfolioImportRowStatus.READY)], [group(PortfolioImportAssetGroupStatus.UNMATCHED)]))
        .toBe(PortfolioImportSessionStatus.NEEDS_ASSET_REVIEW);
    });

    it('returns ready_to_import for ready rows with no blocking rows', () => {
      expect(recomputeImportSessionStatus([row(PortfolioImportRowStatus.READY), row(PortfolioImportRowStatus.READY)], []))
        .toBe(PortfolioImportSessionStatus.READY_TO_IMPORT);
    });

    it('returns partial when ready rows coexist with blocking rows', () => {
      expect(recomputeImportSessionStatus([row(PortfolioImportRowStatus.READY), row(PortfolioImportRowStatus.DUPLICATE)], []))
        .toBe(PortfolioImportSessionStatus.PARTIAL);
      expect(recomputeImportSessionStatus([row(PortfolioImportRowStatus.READY), row(PortfolioImportRowStatus.SKIPPED)], []))
        .toBe(PortfolioImportSessionStatus.PARTIAL);
    });

    it('returns partial when only blocking rows exist', () => {
      expect(recomputeImportSessionStatus([row(PortfolioImportRowStatus.INVALID)], [])).toBe(PortfolioImportSessionStatus.PARTIAL);
    });

    it('returns failed for an empty session', () => {
      expect(recomputeImportSessionStatus([], [])).toBe(PortfolioImportSessionStatus.FAILED);
    });

    it('ignores non-blocking group statuses', () => {
      expect(recomputeImportSessionStatus([row(PortfolioImportRowStatus.READY)], [group(PortfolioImportAssetGroupStatus.MATCHED)]))
        .toBe(PortfolioImportSessionStatus.READY_TO_IMPORT);
    });
  });

  describe('canConfirm', () => {
    it('allows ready_to_import regardless of summary counts', () => {
      expect(canConfirm({ status: PortfolioImportSessionStatus.READY_TO_IMPORT, summaryJson: {} })).toBe(true);
    });

    it('allows partial with ready rows and no asset-review rows', () => {
      expect(canConfirm({ status: PortfolioImportSessionStatus.PARTIAL, summaryJson: { needsAssetReviewRows: 0, readyRows: 3 } })).toBe(true);
    });

    it('rejects partial with no ready rows', () => {
      expect(canConfirm({ status: PortfolioImportSessionStatus.PARTIAL, summaryJson: { needsAssetReviewRows: 0, readyRows: 0 } })).toBe(false);
    });

    it('rejects partial with rows still needing asset review', () => {
      expect(canConfirm({ status: PortfolioImportSessionStatus.PARTIAL, summaryJson: { needsAssetReviewRows: 1, readyRows: 3 } })).toBe(false);
    });

    it('rejects non-confirmable statuses', () => {
      expect(canConfirm({ status: PortfolioImportSessionStatus.NEEDS_ASSET_REVIEW, summaryJson: { readyRows: 3 } })).toBe(false);
      expect(canConfirm({ status: PortfolioImportSessionStatus.FAILED, summaryJson: { readyRows: 3 } })).toBe(false);
      expect(canConfirm({ status: PortfolioImportSessionStatus.IMPORTING })).toBe(false);
    });
  });

  describe('terminalKind', () => {
    it('maps terminal statuses', () => {
      expect(terminalKind(PortfolioImportSessionStatus.SUCCEEDED)).toBe('success');
      expect(terminalKind(PortfolioImportSessionStatus.PARTIAL)).toBe('partial_success');
      expect(terminalKind(PortfolioImportSessionStatus.CANCELLED)).toBe('cancelled');
      expect(terminalKind(PortfolioImportSessionStatus.EXPIRED)).toBe('expired');
      expect(terminalKind(PortfolioImportSessionStatus.FAILED)).toBe('failed');
    });

    it('falls back to failed for non-terminal statuses', () => {
      expect(terminalKind(PortfolioImportSessionStatus.PARSING)).toBe('failed');
      expect(terminalKind(PortfolioImportSessionStatus.READY_TO_IMPORT)).toBe('failed');
    });
  });

  describe('toTerminalKind', () => {
    it('accepts known kinds and rejects unknown values', () => {
      expect(toTerminalKind('duplicate_only')).toBe('duplicate_only');
      expect(toTerminalKind('success')).toBe('success');
      expect(toTerminalKind('not_a_kind')).toBeUndefined();
      expect(toTerminalKind(undefined)).toBeUndefined();
      expect(toTerminalKind(42)).toBeUndefined();
    });
  });
});
