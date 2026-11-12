import { LockMode } from '@mikro-orm/core';
import type { EntityManager } from '@mikro-orm/postgresql';

import { HIDDEN_FILTER, setTenantContext } from '@app/database/filters/tenant-filter';
import { ApiToken } from '@entity/ApiToken';
import type { Appuser } from '@entity/Appuser';
import { AssistantProposal, AssistantProposalKind, AssistantProposalSource, AssistantProposalStatus } from '@entity/AssistantProposal';
import type { Category } from '@entity/Category';
import type { Tenant } from '@entity/Tenant';
import { Transaction } from '@entity/Transaction';
import { isAiHidden } from '@service/ai/ai-availability';
import { findAssignableCategory } from '@service/transaction/household-category';
import { applyBulkTransactionChange, BULK_CHANGE_POPULATE } from '@service/transaction/transaction-bulk-update.service';
import { updateTransactionNote } from '@service/transaction/transaction-note.service';
import { loadTransactionSelection } from '@service/transaction/transaction-selection.service';
import { getRef } from '@utils/em-helpers';
import { ConflictError, ERROR_CODE, NotFoundError } from '@utils/errors';
import logger from '@utils/logger';

import { parseProposalPayload, PROPOSAL_LIFETIME_MS, type ProposalPayload, transactionIdsOf } from './assistant-proposal-payload';

/** The audit `source` of every transaction change an applied proposal makes. */
export const PROPOSAL_AUDIT_SOURCE = 'assistant-proposal';

export type ProposalFailureReason = 'category_unavailable' | 'transaction_unavailable';
export type ProposalRefusalReason = 'ai_hidden' | ProposalFailureReason;

/** The member a proposal is for. `em` must carry their tenant context (the request EM does). */
export interface AssistantProposalChangeDto {
  after: boolean | null | string;
  before: boolean | null | string;
  description: null | string;
  field: 'category' | 'note' | 'reviewed';
  transactionDate: null | string;
  transactionId: number;
}

export interface AssistantProposalDto {
  changes: AssistantProposalChangeDto[];
  createdAt: string;
  decidedAt: null | string;
  expiresAt: string;
  failureReason: null | string;
  id: number;
  kind: AssistantProposalKind;
  source: AssistantProposalSource;
  status: AssistantProposalStatus;
  summary: string;
  unavailableCount: number;
}

export type CreateProposalResult =
  | { proposal: AssistantProposalDto; status: 'proposed' }
  | { reason: ProposalRefusalReason; status: 'refused' };

export interface ProposalOrigin {
  /** The MCP client's token; absent for the in-app assistant. */
  apiTokenKey?: number;
  source: AssistantProposalSource;
}

export interface ProposalViewer {
  appuser: Appuser;
  tenant: Tenant;
}

/**
 * Draft a proposal: check that every transaction (and the category) is one the member can see and
 * use, then insert one `assistant_proposal` row. Nothing else is written; the change waits for
 * the member to apply it.
 *
 * A refusal is a result, not an error, so the assistant and an MCP client can tell the person why.
 */
export async function createProposal(
  em: EntityManager,
  viewer: ProposalViewer,
  origin: ProposalOrigin,
  parsed: ProposalPayload,
  now = new Date(),
): Promise<CreateProposalResult> {
  if (isAiHidden(viewer.appuser)) return { reason: 'ai_hidden', status: 'refused' };

  const check = await checkTargets(em, viewer, parsed);
  if (!check.ok) return { reason: check.reason, status: 'refused' };

  const proposal = new AssistantProposal();
  proposal.appuserKey = viewer.appuser;
  proposal.tenantKey = viewer.tenant;
  proposal.source = origin.source;
  if (origin.apiTokenKey !== undefined) proposal.apiTokenKey = getRef(em, ApiToken, origin.apiTokenKey);
  proposal.kind = parsed.kind;
  proposal.payload = parsed.payload;
  proposal.summary = summarize(parsed, check.category);
  proposal.status = AssistantProposalStatus.PENDING;
  proposal.expiresAt = new Date(now.getTime() + PROPOSAL_LIFETIME_MS);
  await em.persist(proposal).flush();

  const [dto] = await toProposalDtos(em, viewer, [proposal]);
  if (!dto) throw new Error('Proposal could not be read back');
  return { proposal: dto, status: 'proposed' };
}

/** The member's proposals with `status`, newest first. A pending one past its expiry is not pending. */
export async function listProposals(
  em: EntityManager,
  viewer: ProposalViewer,
  query: { limit: number; status: AssistantProposalStatus },
  now = new Date(),
): Promise<AssistantProposalDto[]> {
  const where: Record<string, unknown> = { appuserKey: viewer.appuser, deletedAt: null, status: query.status, tenantKey: viewer.tenant };
  if (query.status === AssistantProposalStatus.PENDING) where['expiresAt'] = { $gt: now };
  const proposals = await em.find(AssistantProposal, where, { limit: query.limit, orderBy: { assistantProposalKey: 'desc' } });
  return toProposalDtos(em, viewer, proposals);
}

/**
 * Apply a pending proposal: re-check its state, its expiry and that every transaction and the
 * category are still the member's to change, then make the change through the same services the
 * ordinary endpoints use, with the audit `source` {@link PROPOSAL_AUDIT_SOURCE}.
 *
 * One database transaction holds the proposal row locked, so two concurrent applies change the
 * rows once, and the proposal is `applied` exactly when the change committed. Applying an applied
 * proposal again is a no-op that returns it.
 */
export async function applyProposal(em: EntityManager, viewer: ProposalViewer, proposalKey: number, now = new Date()): Promise<AssistantProposalDto> {
  const outcome = await em.transactional(async (tx) => {
    setTenantContext(tx, { appuserKey: viewer.appuser.appuserKey, tenantKey: viewer.tenant.tenantKey });
    const proposal = await lockOwnProposal(tx, viewer, proposalKey);
    if (proposal.status === AssistantProposalStatus.APPLIED) return { proposal, result: 'already_applied' as const };
    if (proposal.status !== AssistantProposalStatus.PENDING) return { proposal, result: 'not_pending' as const };
    if (proposal.expiresAt.getTime() <= now.getTime()) {
      decide(proposal, AssistantProposalStatus.EXPIRED, now);
      return { proposal, result: 'expired' as const };
    }

    let parsed: ProposalPayload;
    try {
      parsed = parseProposalPayload(proposal.kind, proposal.payload);
    } catch (error) {
      logger.warn({ assistantProposalKey: proposal.assistantProposalKey, err: error }, 'Stored assistant proposal payload no longer parses');
      decide(proposal, AssistantProposalStatus.FAILED, now, 'transaction_unavailable');
      return { proposal, result: 'failed' as const };
    }

    const check = await checkTargets(tx, viewer, parsed);
    if (!check.ok) {
      decide(proposal, AssistantProposalStatus.FAILED, now, check.reason);
      return { proposal, result: 'failed' as const };
    }

    await applyChange(tx, viewer, parsed, check);
    decide(proposal, AssistantProposalStatus.APPLIED, now);
    return { proposal, result: 'applied' as const };
  });

  switch (outcome.result) {
    case 'expired':
      throw new ConflictError('This proposal expired; nothing was changed', ERROR_CODE.ASSISTANT_PROPOSAL_EXPIRED);
    case 'failed':
      throw new ConflictError('This proposal can no longer be applied; nothing was changed', ERROR_CODE.ASSISTANT_PROPOSAL_FAILED);
    case 'not_pending':
      throw new ConflictError(`This proposal is ${outcome.proposal.status}`, ERROR_CODE.ASSISTANT_PROPOSAL_NOT_PENDING);
    default: {
      const [dto] = await toProposalDtos(em, viewer, [outcome.proposal]);
      if (!dto) throw new Error('Proposal could not be read back');
      return dto;
    }
  }
}

/**
 * Dismiss a proposal. Dismissing a dismissed (or lapsed) one again returns it unchanged; one
 * already applied, or one that failed, cannot be dismissed.
 */
export async function rejectProposal(em: EntityManager, viewer: ProposalViewer, proposalKey: number, now = new Date()): Promise<AssistantProposalDto> {
  const proposal = await em.transactional(async (tx) => {
    setTenantContext(tx, { appuserKey: viewer.appuser.appuserKey, tenantKey: viewer.tenant.tenantKey });
    const locked = await lockOwnProposal(tx, viewer, proposalKey);
    if (locked.status === AssistantProposalStatus.PENDING) {
      decide(locked, locked.expiresAt.getTime() <= now.getTime() ? AssistantProposalStatus.EXPIRED : AssistantProposalStatus.REJECTED, now);
    }
    return locked;
  });
  if (proposal.status === AssistantProposalStatus.APPLIED || proposal.status === AssistantProposalStatus.FAILED) {
    throw new ConflictError(`This proposal is ${proposal.status}`, ERROR_CODE.ASSISTANT_PROPOSAL_NOT_PENDING);
  }
  const [dto] = await toProposalDtos(em, viewer, [proposal]);
  if (!dto) throw new Error('Proposal could not be read back');
  return dto;
}

/**
 * Mark every pending proposal past its expiry as `expired`, across all households (the worker EM
 * has no tenant context). Returns how many lapsed.
 */
export async function expireProposals(em: EntityManager, now = new Date()): Promise<number> {
  return em.nativeUpdate(
    AssistantProposal,
    { deletedAt: null, expiresAt: { $lte: now }, status: AssistantProposalStatus.PENDING },
    { decidedAt: now, status: AssistantProposalStatus.EXPIRED, updatedAt: now },
    { filters: false },
  );
}

/**
 * Build the DTOs for `proposals`, reading each transaction's current value live through the tenant
 * filter: a transaction the member can no longer see is counted in `unavailableCount`, never shown.
 */
type TargetCheck =
  | { category: Category | null; ok: true; transactions: Transaction[] }
  | { ok: false; reason: ProposalFailureReason };

export async function toProposalDtos(em: EntityManager, viewer: ProposalViewer, proposals: AssistantProposal[]): Promise<AssistantProposalDto[]> {
  const parsedByKey = new Map<number, null | ProposalPayload>();
  const transactionIds = new Set<number>();
  const categoryIds = new Set<number>();
  for (const proposal of proposals) {
    let parsed: null | ProposalPayload = null;
    try {
      parsed = parseProposalPayload(proposal.kind, proposal.payload);
    } catch {
      parsed = null;
    }
    parsedByKey.set(proposal.assistantProposalKey, parsed);
    if (!parsed) continue;
    for (const id of transactionIdsOf(parsed)) transactionIds.add(id);
    if (parsed.kind === AssistantProposalKind.CATEGORIZE_TRANSACTIONS) categoryIds.add(parsed.payload.categoryId);
  }

  const transactions = transactionIds.size > 0
    ? await em.find(
        Transaction,
        { deletedAt: undefined, tenantKey: viewer.tenant, transactionKey: { $in: [...transactionIds] } },
        { filters: { [HIDDEN_FILTER]: false }, populate: ['appuserTransactionCategories.categoryKey'] },
      )
    : [];
  const transactionsById = new Map(transactions.map((transaction) => [transaction.transactionKey, transaction]));
  const categoryNames = new Map<number, null | string>();
  for (const categoryId of categoryIds) {
    categoryNames.set(categoryId, (await findAssignableCategory(em, viewer.tenant, categoryId))?.name ?? null);
  }

  return proposals.map((proposal) => {
    const parsed = parsedByKey.get(proposal.assistantProposalKey) ?? null;
    const ids = parsed ? transactionIdsOf(parsed) : [];
    const changes = parsed
      ? ids.flatMap((id) => {
          const transaction = transactionsById.get(id);
          return transaction ? [changeOf(parsed, transaction, categoryNames)] : [];
        })
      : [];
    return {
      changes,
      createdAt: proposal.createdAt.toISOString(),
      decidedAt: proposal.decidedAt?.toISOString() ?? null,
      expiresAt: proposal.expiresAt.toISOString(),
      failureReason: proposal.failureReason ?? null,
      id: proposal.assistantProposalKey,
      kind: proposal.kind,
      source: proposal.source,
      status: proposal.status,
      summary: proposal.summary,
      unavailableCount: ids.length - changes.length,
    };
  });
}

/**
 * Every transaction must be a live row the member can see (the tenant filter hides another
 * household's rows and the partner's private accounts), and the category one they may assign.
 */
async function checkTargets(em: EntityManager, viewer: ProposalViewer, parsed: ProposalPayload): Promise<TargetCheck> {
  let transactions: Transaction[];
  try {
    transactions = await loadTransactionSelection(
      em,
      { tenant: viewer.tenant, viewerAppuserKey: viewer.appuser.appuserKey },
      { transactionIds: transactionIdsOf(parsed) },
      { populate: [...BULK_CHANGE_POPULATE] },
    );
  } catch (error) {
    if (error instanceof NotFoundError) return { ok: false, reason: 'transaction_unavailable' };
    throw error;
  }
  if (parsed.kind !== AssistantProposalKind.CATEGORIZE_TRANSACTIONS) return { category: null, ok: true, transactions };
  const category = await findAssignableCategory(em, viewer.tenant, parsed.payload.categoryId);
  if (!category) return { ok: false, reason: 'category_unavailable' };
  return { category, ok: true, transactions };
}

/** The change itself, through the services `PATCH /v1/account/transaction[/:id]` uses. */
async function applyChange(em: EntityManager, viewer: ProposalViewer, parsed: ProposalPayload, check: Extract<TargetCheck, { ok: true }>): Promise<void> {
  const options = { auditSource: PROPOSAL_AUDIT_SOURCE };
  switch (parsed.kind) {
    case AssistantProposalKind.CATEGORIZE_TRANSACTIONS:
      await applyBulkTransactionChange(em, viewer, check.transactions, { category: check.category }, options);
      return;
    case AssistantProposalKind.MARK_TRANSACTIONS_REVIEWED:
      await applyBulkTransactionChange(em, viewer, check.transactions, { reviewed: true }, options);
      return;
    case AssistantProposalKind.UPDATE_TRANSACTION_NOTE: {
      const [transaction] = check.transactions;
      if (transaction) await updateTransactionNote(em, viewer, transaction, parsed.payload.note, options);
      return;
    }
  }
}

function changeOf(parsed: ProposalPayload, transaction: Transaction, categoryNames: Map<number, null | string>): AssistantProposalChangeDto {
  const base = {
    description: transaction.description ?? null,
    transactionDate: transaction.transactionDate?.toISOString() ?? null,
    transactionId: transaction.transactionKey,
  };
  switch (parsed.kind) {
    case AssistantProposalKind.CATEGORIZE_TRANSACTIONS:
      return {
        ...base,
        after: categoryNames.get(parsed.payload.categoryId) ?? null,
        before: transaction.appuserTransactionCategories.getItems()[0]?.categoryKey.name ?? null,
        field: 'category',
      };
    case AssistantProposalKind.MARK_TRANSACTIONS_REVIEWED:
      return { ...base, after: true, before: transaction.reviewed, field: 'reviewed' };
    case AssistantProposalKind.UPDATE_TRANSACTION_NOTE:
      return { ...base, after: parsed.payload.note, before: transaction.notes ?? null, field: 'note' };
  }
}

function decide(proposal: AssistantProposal, status: AssistantProposalStatus, now: Date, failureReason?: ProposalFailureReason): void {
  proposal.status = status;
  proposal.decidedAt = now;
  proposal.failureReason = failureReason;
}

/** The member's own proposal, locked for the rest of the transaction. Anyone else's is a 404. */
async function lockOwnProposal(em: EntityManager, viewer: ProposalViewer, proposalKey: number): Promise<AssistantProposal> {
  const proposal = await em.findOne(
    AssistantProposal,
    { appuserKey: viewer.appuser, assistantProposalKey: proposalKey, deletedAt: null, tenantKey: viewer.tenant },
    { lockMode: LockMode.PESSIMISTIC_WRITE },
  );
  if (!proposal) throw new NotFoundError('Proposal not found');
  return proposal;
}

function summarize(parsed: ProposalPayload, category: Category | null): string {
  switch (parsed.kind) {
    case AssistantProposalKind.CATEGORIZE_TRANSACTIONS: {
      const count = parsed.payload.transactionIds.length;
      return `Categorize ${count} ${count === 1 ? 'transaction' : 'transactions'} as ${category?.name ?? 'the chosen category'}`;
    }
    case AssistantProposalKind.MARK_TRANSACTIONS_REVIEWED: {
      const count = parsed.payload.transactionIds.length;
      return `Mark ${count} ${count === 1 ? 'transaction' : 'transactions'} as reviewed`;
    }
    case AssistantProposalKind.UPDATE_TRANSACTION_NOTE:
      return parsed.payload.note === null ? 'Clear the note on 1 transaction' : 'Set the note on 1 transaction';
  }
}
