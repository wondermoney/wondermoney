/**
 * Canonical portfolio import session state derivation.
 *
 * Owns the terminal-kind vocabulary, the confirmable predicate, and the row/group
 * status + summary computations that were previously copied across the portfolio
 * import services. Helpers are pure: they read entities by reference and return
 * values. Callers stay responsible for persistence, matching the existing
 * per-module transactional pattern.
 */
import { PortfolioImportAssetGroup, PortfolioImportAssetGroupStatus } from '@entity/PortfolioImportAssetGroup';
import { PortfolioImportRow, PortfolioImportRowStatus } from '@entity/PortfolioImportRow';
import { PortfolioImportSessionStatus } from '@entity/PortfolioImportSession';

export interface ImportSessionStateView {
  status: PortfolioImportSessionStatus;
  summaryJson?: null | Record<string, unknown>;
}

export interface ImportSessionSummary {
  assetGroups: {
    ambiguousGroups: number;
    matchedGroups: number;
    providerErrorGroups: number;
    selectedGroups: number;
    skippedGroups: number;
    totalGroups: number;
    unmatchedGroups: number;
  };
  duplicateRows: number;
  invalidRows: number;
  needsAssetReviewRows: number;
  readyRows: number;
  skippedRows: number;
  totalRows: number;
}

export type TerminalKind = 'cancelled' | 'duplicate_only' | 'expired' | 'failed' | 'partial_success' | 'success';

const BLOCKING_GROUP_STATUSES: readonly PortfolioImportAssetGroupStatus[] = [
  PortfolioImportAssetGroupStatus.AMBIGUOUS,
  PortfolioImportAssetGroupStatus.PROVIDER_ERROR,
  PortfolioImportAssetGroupStatus.UNMATCHED,
];

const BLOCKING_ROW_STATUSES: readonly PortfolioImportRowStatus[] = [
  PortfolioImportRowStatus.DUPLICATE,
  PortfolioImportRowStatus.INVALID,
  PortfolioImportRowStatus.NEEDS_ASSET_REVIEW,
  PortfolioImportRowStatus.SKIPPED,
];

const TERMINAL_KINDS: readonly TerminalKind[] = ['cancelled', 'duplicate_only', 'expired', 'failed', 'partial_success', 'success'];

/**
 * Row/group counts for a session summary. Canonical source for the summary shape
 * previously duplicated in `portfolio-import-asset-mapping` and friends.
 */
export function buildImportSessionSummary(rows: PortfolioImportRow[], groups: PortfolioImportAssetGroup[]): ImportSessionSummary {
  const readyRows = rows.filter((row) => row.status === PortfolioImportRowStatus.READY).length;
  const duplicateRows = rows.filter((row) => row.status === PortfolioImportRowStatus.DUPLICATE).length;
  const invalidRows = rows.filter((row) => row.status === PortfolioImportRowStatus.INVALID).length;
  const needsAssetReviewRows = rows.filter((row) => row.status === PortfolioImportRowStatus.NEEDS_ASSET_REVIEW).length;
  const skippedRows = rows.filter((row) => row.status === PortfolioImportRowStatus.SKIPPED).length;
  const totalGroups = groups.length;
  return {
    assetGroups: {
      ambiguousGroups: groups.filter((group) => group.status === PortfolioImportAssetGroupStatus.AMBIGUOUS).length,
      matchedGroups: groups.filter((group) => group.status === PortfolioImportAssetGroupStatus.MATCHED).length,
      providerErrorGroups: groups.filter((group) => group.status === PortfolioImportAssetGroupStatus.PROVIDER_ERROR).length,
      selectedGroups: groups.filter((group) => group.status === PortfolioImportAssetGroupStatus.SELECTED).length,
      skippedGroups: groups.filter((group) => group.status === PortfolioImportAssetGroupStatus.SKIPPED).length,
      totalGroups,
      unmatchedGroups: groups.filter((group) => group.status === PortfolioImportAssetGroupStatus.UNMATCHED).length,
    },
    duplicateRows,
    invalidRows,
    needsAssetReviewRows,
    readyRows,
    skippedRows,
    totalRows: rows.length,
  };
}

/**
 * Canonical session status derived from rows and asset groups. Extracted from
 * `portfolio-import-asset-mapping.service.ts` (the most thorough variant): a
 * blocking group forces NEEDS_ASSET_REVIEW, otherwise ready rows without any
 * blocking row are READY_TO_IMPORT, any ready or blocking row is PARTIAL, and a
 * fully empty/no-op session is FAILED.
 */
export function recomputeImportSessionStatus(rows: PortfolioImportRow[], groups: PortfolioImportAssetGroup[]): PortfolioImportSessionStatus {
  if (groups.some((group) => BLOCKING_GROUP_STATUSES.includes(group.status))) return PortfolioImportSessionStatus.NEEDS_ASSET_REVIEW;
  const { readyRows } = buildImportSessionSummary(rows, groups);
  const hasBlocking = rows.some((row) => BLOCKING_ROW_STATUSES.includes(row.status));
  if (readyRows > 0 && !hasBlocking) return PortfolioImportSessionStatus.READY_TO_IMPORT;
  if (readyRows > 0 || hasBlocking) return PortfolioImportSessionStatus.PARTIAL;
  return PortfolioImportSessionStatus.FAILED;
}

/**
 * Transition rule for whether a session may be confirmed/imported:
 * READY_TO_IMPORT always, or PARTIAL with at least one ready row and no rows
 * still awaiting asset review.
 */
export function canConfirm(session: ImportSessionStateView): boolean {
  if (session.status === PortfolioImportSessionStatus.READY_TO_IMPORT) return true;
  if (session.status !== PortfolioImportSessionStatus.PARTIAL) return false;
  const readyRows = asNonNegativeNumber(session.summaryJson?.['readyRows']);
  const needsAssetReviewRows = asNonNegativeNumber(session.summaryJson?.['needsAssetReviewRows']);
  return readyRows > 0 && needsAssetReviewRows === 0;
}

/**
 * Maps a terminal session status to its terminal kind. In-progress statuses fall
 * back to `failed`.
 */
export function terminalKind(status: PortfolioImportSessionStatus): TerminalKind {
  switch (status) {
    case PortfolioImportSessionStatus.CANCELLED:
      return 'cancelled';
    case PortfolioImportSessionStatus.EXPIRED:
      return 'expired';
    case PortfolioImportSessionStatus.PARTIAL:
      return 'partial_success';
    case PortfolioImportSessionStatus.SUCCEEDED:
      return 'success';
    default:
      return 'failed';
  }
}

/**
 * Validates an untrusted stored value into the terminal-kind union, returning
 * `undefined` when it is not a known kind.
 */
export function toTerminalKind(value: unknown): TerminalKind | undefined {
  return typeof value === 'string' && (TERMINAL_KINDS as readonly string[]).includes(value) ? (value as TerminalKind) : undefined;
}

function asNonNegativeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}
