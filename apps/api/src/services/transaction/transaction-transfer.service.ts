import { type EntityManager, wrap } from '@mikro-orm/core';

import { Account } from '@entity/Account';
import type { Appuser } from '@entity/Appuser';
import { Goal } from '@entity/Goal';
import { Portfolio } from '@entity/Portfolio';
import type { Tenant } from '@entity/Tenant';
import type { Transaction } from '@entity/Transaction';
import { TransactionAuditActorType, TransactionAuditEventType } from '@entity/TransactionAuditLog';
import { TransactionType } from '@entity/TransactionType';
import { BadRequestError, InternalServerError, NotFoundError } from '@utils/errors';

import { TransactionAuditService } from './transaction-audit.service';

/**
 * A user re-typing a transaction: "mark as transfer" and its undo.
 *
 * Transfer matching (`transfer-matching.service.ts`) only types a row TRANSFER_OUT / TRANSFER_IN
 * when it finds the other half on another household account. A payment to a broker or to an
 * account outside WonderMoney has none, so the user says so here. The new type is audited as a USER
 * change of `transactionTypeKey`, which is what makes it user-set: matching never changes it back.
 *
 * The type must agree with the amount's direction: money out is PAYMENT or TRANSFER_OUT, money in
 * DEPOSIT or TRANSFER_IN. An outgoing transfer may name where the money went (another household
 * account the user can see, a portfolio or a goal of the household); the destination describes the
 * row only and is cleared when the row stops being an outgoing transfer.
 */
export const USER_SETTABLE_TYPES = ['TRANSFER_OUT', 'TRANSFER_IN', 'PAYMENT', 'DEPOSIT'] as const;
export type UserSettableType = (typeof USER_SETTABLE_TYPES)[number];

export const TRANSFER_DESTINATION_TYPES = ['account', 'portfolio', 'goal'] as const;
export interface TransferDestinationDto {
  key: number;
  name: string;
  type: TransferDestinationType;
}

export interface TransferDestinationInput {
  key: number;
  type: TransferDestinationType;
}

export type TransferDestinationType = (typeof TRANSFER_DESTINATION_TYPES)[number];

/** The relations {@link transferDestinationOf} reads. */
export const TRANSFER_DESTINATION_POPULATE = ['transferDestinationAccountKey', 'transferDestinationPortfolioKey', 'transferDestinationGoalKey'] as const;

export interface RetypeInput {
  actor: Appuser;
  /** Undefined: leave as it is. Null: clear it. */
  destination?: null | TransferDestinationInput;
  tenant: Tenant;
  /** The loaded row, with `accountKey`, `transactionTypeKey` and {@link TRANSFER_DESTINATION_POPULATE} populated. */
  transaction: Transaction;
  typeName?: UserSettableType;
}

export interface RetypeResult {
  /** Whether the type changed, so transfer matching should look at the row again. */
  typeChanged: boolean;
}

/**
 * Validate the whole request first, then apply it to `transaction` and audit it (flushed by the
 * caller). Throws 400 for a type against the amount's direction or a destination on anything but an
 * outgoing transfer, 404 for a destination the user cannot see.
 */
export async function retypeTransaction(em: EntityManager, input: RetypeInput): Promise<RetypeResult> {
  const { actor, tenant, transaction } = input;
  const currentType = transaction.transactionTypeKey?.name ?? null;
  const nextType = input.typeName ?? currentType;

  if (input.typeName !== undefined) {
    const amount = transaction.settlementAmount ?? 0;
    if (amount === 0) throw new BadRequestError('A transaction with no amount cannot be re-typed');
    const allowed = amount < 0 ? ['PAYMENT', 'TRANSFER_OUT'] : ['DEPOSIT', 'TRANSFER_IN'];
    if (!allowed.includes(input.typeName)) throw new BadRequestError(amount < 0 ? 'Money out can only be a payment or an outgoing transfer' : 'Money in can only be a deposit or an incoming transfer');
  }

  const destinationBefore = destinationRef(transaction);
  let destinationAfter = nextType === 'TRANSFER_OUT' ? destinationBefore : null;
  let destinationEntity: Account | Goal | null | Portfolio = null;
  if (input.destination !== undefined && input.destination !== null) {
    if (nextType !== 'TRANSFER_OUT') throw new BadRequestError('Only an outgoing transfer has a destination');
    destinationEntity = await findDestination(em, input.destination, actor, tenant);
    if (input.destination.type === 'account' && input.destination.key === transaction.accountKey?.accountKey) throw new BadRequestError('A transfer cannot go to its own account');
    destinationAfter = input.destination;
  } else if (input.destination === null) {
    destinationAfter = null;
  }

  const typeChanged = nextType !== currentType;
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  if (typeChanged && nextType !== null) {
    const type = await em.findOne(TransactionType, { name: nextType });
    if (!type) throw new InternalServerError(`Transaction type ${nextType} not found`);
    transaction.transactionTypeKey = type;
    changes['transactionTypeKey'] = { from: currentType, to: nextType };
  }
  if (!sameDestination(destinationBefore, destinationAfter)) {
    transaction.transferDestinationAccountKey = destinationAfter?.type === 'account' ? (destinationEntity as Account | null) ?? transaction.transferDestinationAccountKey : undefined;
    transaction.transferDestinationPortfolioKey = destinationAfter?.type === 'portfolio' ? (destinationEntity as null | Portfolio) ?? transaction.transferDestinationPortfolioKey : undefined;
    transaction.transferDestinationGoalKey = destinationAfter?.type === 'goal' ? (destinationEntity as Goal | null) ?? transaction.transferDestinationGoalKey : undefined;
    changes['transferDestination'] = { from: destinationBefore, to: destinationAfter };
  }
  if (Object.keys(changes).length > 0) {
    await TransactionAuditService.log(em, {
      accountKey: transaction.accountKey?.accountKey ?? null,
      actorAppuserKey: actor.appuserKey,
      actorType: TransactionAuditActorType.USER,
      appuserKey: actor.appuserKey,
      changes,
      eventType: TransactionAuditEventType.USER_EDIT,
      source: 'user-edit',
      tenantKey: tenant.tenantKey,
      transactionKey: transaction.transactionKey,
    }, { flush: false });
  }
  return { typeChanged };
}

/**
 * The row's destination for display. An account the viewer cannot see (a partner's private one) is
 * not named. Populate {@link TRANSFER_DESTINATION_POPULATE} first.
 */
export function transferDestinationOf(transaction: Transaction, viewerAppuserKey: number): null | TransferDestinationDto {
  const account = transaction.transferDestinationAccountKey;
  if (account) {
    // Not loaded: the tenant filter kept it from this viewer.
    if (!wrap(account).isInitialized() || account.deletedAt || (account.isPrivate && account.accountOwnerAppuserKey?.appuserKey !== viewerAppuserKey)) return null;
    return { key: account.accountKey, name: account.accountName ?? '', type: 'account' };
  }
  const portfolio = transaction.transferDestinationPortfolioKey;
  if (portfolio && wrap(portfolio).isInitialized() && !portfolio.deletedAt) return { key: portfolio.portfolioKey, name: portfolio.name, type: 'portfolio' };
  const goal = transaction.transferDestinationGoalKey;
  if (goal && wrap(goal).isInitialized() && !goal.deletedAt) return { key: goal.goalKey, name: goal.name, type: 'goal' };
  return null;
}

function destinationRef(transaction: Transaction): null | TransferDestinationInput {
  if (transaction.transferDestinationAccountKey) return { key: transaction.transferDestinationAccountKey.accountKey, type: 'account' };
  if (transaction.transferDestinationPortfolioKey) return { key: transaction.transferDestinationPortfolioKey.portfolioKey, type: 'portfolio' };
  if (transaction.transferDestinationGoalKey) return { key: transaction.transferDestinationGoalKey.goalKey, type: 'goal' };
  return null;
}

function sameDestination(a: null | TransferDestinationInput, b: null | TransferDestinationInput): boolean {
  return a?.type === b?.type && a?.key === b?.key;
}

/** A live destination in the household that the actor may see; 404 otherwise. */
async function findDestination(em: EntityManager, destination: TransferDestinationInput, actor: Appuser, tenant: Tenant): Promise<Account | Goal | Portfolio> {
  const found = destination.type === 'account'
    ? await em.findOne(Account, { $or: [{ isPrivate: false }, { accountOwnerAppuserKey: actor }], accountKey: destination.key, deletedAt: null, tenantKey: tenant })
    : destination.type === 'portfolio'
      ? await em.findOne(Portfolio, { deletedAt: null, portfolioKey: destination.key, tenantKey: tenant })
      : await em.findOne(Goal, { deletedAt: null, goalKey: destination.key, tenantKey: tenant });
  if (!found) throw new NotFoundError('Transfer destination not found');
  return found;
}
