import type { EntityManager } from '@mikro-orm/postgresql';

import { Account } from '@entity/Account';
import { Appuser } from '@entity/Appuser';
import { Category } from '@entity/Category';
import { Tenant } from '@entity/Tenant';
import { Transaction } from '@entity/Transaction';
import { TransactionMerchant } from '@entity/TransactionMerchant';
import { TransactionTemplate, TransactionTemplateDirection } from '@entity/TransactionTemplate';
import { visibleAccountWhere } from '@service/account/account-access';
import { findAssignableCategory } from '@service/transaction/household-category';
import { getRef } from '@utils/em-helpers';
import { BadRequestError, NotFoundError } from '@utils/errors';

/**
 * Saved manual entries ("templates") for frequent cash or offline transactions.
 *
 * Every read and write is scoped twice: by the owner in the query and by the request's
 * owner-scoped tenant filter. Another member's template is a 404, and a template can only
 * name an account that its owner can see (never the other member's private account).
 *
 * A template never creates a transaction: the clients use it to pre-fill the add form.
 */

export interface TransactionTemplateActor {
  appuserKey: number;
  tenantKey: number;
}

export interface TransactionTemplateDto {
  account: null | { accountKey: number; accountName: null | string };
  amount: null | number;
  category: null | { categoryKey: number; name: string };
  description: null | string;
  direction: TransactionTemplateDirection;
  name: string;
  notes: null | string;
  position: number;
  transactionMerchant: null | { name: string; transactionMerchantKey: number };
  transactionTemplateKey: number;
}

export interface TransactionTemplateInput {
  accountKey?: null | number;
  amount?: null | number;
  categoryKey?: null | number;
  description?: null | string;
  direction?: TransactionTemplateDirection;
  /** Copy the fields of a transaction this member can see; explicit fields win. */
  fromTransactionId?: number;
  name?: string;
  notes?: null | string;
  position?: number;
  transactionMerchantKey?: null | number;
}

const POPULATE = ['accountKey', 'categoryKey', 'transactionMerchantKey'] as const;

export async function createTransactionTemplate(
  em: EntityManager,
  actor: TransactionTemplateActor,
  input: TransactionTemplateInput,
): Promise<TransactionTemplateDto> {
  const copied = input.fromTransactionId === undefined ? {} : await copyFromTransaction(em, actor, input.fromTransactionId);
  const merged: TransactionTemplateInput = { ...copied, ...definedFields(input) };

  const name = merged.name?.trim();
  if (!name) throw new BadRequestError('Name is required');
  if (!merged.direction) throw new BadRequestError('Direction is required');

  const template = new TransactionTemplate();
  template.tenantKey = getRef(em, Tenant, actor.tenantKey);
  template.ownerAppuserKey = getRef(em, Appuser, actor.appuserKey);
  template.name = name;
  template.direction = merged.direction;
  template.accountKey = merged.accountKey == null ? undefined : await visibleAccountOrThrow(em, actor, merged.accountKey);
  template.amount = merged.amount ?? null;
  template.categoryKey = merged.categoryKey == null ? undefined : await assignableCategoryOrThrow(em, actor, merged.categoryKey);
  template.description = normalizedText(merged.description);
  template.notes = normalizedText(merged.notes);
  template.transactionMerchantKey = merged.transactionMerchantKey == null
    ? undefined
    : await visibleMerchantOrThrow(em, actor, merged.transactionMerchantKey);
  template.position = merged.position ?? await nextPosition(em, actor);

  em.persist(template);
  await em.flush();
  return toTransactionTemplateDto(template);
}

export async function listTransactionTemplates(em: EntityManager, actor: TransactionTemplateActor): Promise<TransactionTemplateDto[]> {
  const templates = await em.find(
    TransactionTemplate,
    ownedWhere(em, actor, { deletedAt: null }),
    { orderBy: { position: 'ASC', transactionTemplateKey: 'ASC' }, populate: [...POPULATE] },
  );
  return templates.map(toTransactionTemplateDto);
}

export async function updateTransactionTemplate(
  em: EntityManager,
  actor: TransactionTemplateActor,
  transactionTemplateKey: number,
  input: Omit<TransactionTemplateInput, 'fromTransactionId'>,
): Promise<TransactionTemplateDto> {
  const template = await findOwnedOrThrow(em, actor, transactionTemplateKey);

  if (input.name !== undefined) template.name = input.name;
  if (input.direction !== undefined) template.direction = input.direction;
  if (input.amount !== undefined) template.amount = input.amount;
  if (input.description !== undefined) template.description = normalizedText(input.description);
  if (input.notes !== undefined) template.notes = normalizedText(input.notes);
  if (input.position !== undefined) template.position = input.position;
  if (input.accountKey !== undefined) {
    template.accountKey = input.accountKey == null ? undefined : await visibleAccountOrThrow(em, actor, input.accountKey);
  }
  if (input.categoryKey !== undefined) {
    template.categoryKey = input.categoryKey == null ? undefined : await assignableCategoryOrThrow(em, actor, input.categoryKey);
  }
  if (input.transactionMerchantKey !== undefined) {
    template.transactionMerchantKey = input.transactionMerchantKey == null
      ? undefined
      : await visibleMerchantOrThrow(em, actor, input.transactionMerchantKey);
  }

  await em.flush();
  return toTransactionTemplateDto(template);
}

/** Soft-delete: the row stays for the audit trail and the list stops showing it. */
export async function deleteTransactionTemplate(em: EntityManager, actor: TransactionTemplateActor, transactionTemplateKey: number): Promise<void> {
  const template = await findOwnedOrThrow(em, actor, transactionTemplateKey);
  template.deletedAt = new Date();
  await em.flush();
}

export function toTransactionTemplateDto(template: TransactionTemplate): TransactionTemplateDto {
  // A soft-deleted account, category or merchant is no longer something the form can offer.
  const account = template.accountKey && !template.accountKey.deletedAt ? template.accountKey : null;
  const category = template.categoryKey && !template.categoryKey.deletedAt ? template.categoryKey : null;
  const merchant = template.transactionMerchantKey && !template.transactionMerchantKey.deletedAt ? template.transactionMerchantKey : null;
  return {
    account: account ? { accountKey: account.accountKey, accountName: account.accountName ?? null } : null,
    amount: template.amount ?? null,
    category: category ? { categoryKey: category.categoryKey, name: category.name } : null,
    description: template.description ?? null,
    direction: template.direction,
    name: template.name,
    notes: template.notes ?? null,
    position: template.position,
    transactionMerchant: merchant ? { name: merchant.name, transactionMerchantKey: merchant.transactionMerchantKey } : null,
    transactionTemplateKey: template.transactionTemplateKey,
  };
}

/** The fields the caller actually sent, so an explicit `null` clears a copied value. */
function definedFields(input: TransactionTemplateInput): Omit<TransactionTemplateInput, 'fromTransactionId'> {
  const fields: Omit<TransactionTemplateInput, 'fromTransactionId'> = {};
  if (input.accountKey !== undefined) fields.accountKey = input.accountKey;
  if (input.amount !== undefined) fields.amount = input.amount;
  if (input.categoryKey !== undefined) fields.categoryKey = input.categoryKey;
  if (input.description !== undefined) fields.description = input.description;
  if (input.direction !== undefined) fields.direction = input.direction;
  if (input.name !== undefined) fields.name = input.name;
  if (input.notes !== undefined) fields.notes = input.notes;
  if (input.position !== undefined) fields.position = input.position;
  if (input.transactionMerchantKey !== undefined) fields.transactionMerchantKey = input.transactionMerchantKey;
  return fields;
}

/**
 * The template fields a transaction already carries. Read through the transaction filter, so
 * another household's row and the other member's private-account row are both a 404.
 */
async function copyFromTransaction(em: EntityManager, actor: TransactionTemplateActor, transactionKey: number): Promise<TransactionTemplateInput> {
  const transaction = await em.findOne(
    Transaction,
    { deletedAt: null, tenantKey: getRef(em, Tenant, actor.tenantKey), transactionKey },
    { populate: ['appuserTransactionCategories.categoryKey', 'transactionMerchantKey'] },
  );
  if (!transaction) throw new NotFoundError('Transaction not found');

  const signedAmount = transaction.editedSettlementAmount ?? transaction.settlementAmount ?? 0;
  const category = transaction.appuserTransactionCategories.find((link) => !link.categoryKey.deletedAt)?.categoryKey;
  const merchant = transaction.transactionMerchantKey;

  return {
    accountKey: transaction.accountKey?.accountKey ?? null,
    amount: signedAmount === 0 ? null : Math.abs(signedAmount),
    categoryKey: category?.categoryKey ?? null,
    description: transaction.description ?? null,
    direction: signedAmount < 0 ? TransactionTemplateDirection.OUT : TransactionTemplateDirection.IN,
    name: merchant?.name ?? transaction.description?.trim() ?? undefined,
    notes: transaction.notes ?? null,
    transactionMerchantKey: merchant?.transactionMerchantKey ?? null,
  };
}

async function findOwnedOrThrow(em: EntityManager, actor: TransactionTemplateActor, transactionTemplateKey: number): Promise<TransactionTemplate> {
  const template = await em.findOne(
    TransactionTemplate,
    ownedWhere(em, actor, { deletedAt: null, transactionTemplateKey }),
    { populate: [...POPULATE] },
  );
  if (!template) throw new NotFoundError('Template not found');
  return template;
}

async function nextPosition(em: EntityManager, actor: TransactionTemplateActor): Promise<number> {
  const last = await em.findOne(
    TransactionTemplate,
    ownedWhere(em, actor, { deletedAt: null }),
    { orderBy: { position: 'DESC' } },
  );
  return last ? last.position + 1 : 0;
}

function ownedWhere(em: EntityManager, actor: TransactionTemplateActor, extra: Record<string, unknown>) {
  return {
    ...extra,
    ownerAppuserKey: getRef(em, Appuser, actor.appuserKey),
    tenantKey: getRef(em, Tenant, actor.tenantKey),
  };
}

/** The household's own category or a global system one; anything else is a 404. */
async function assignableCategoryOrThrow(em: EntityManager, actor: TransactionTemplateActor, categoryKey: number): Promise<Category> {
  const category = await findAssignableCategory(em, actor.tenantKey, categoryKey);
  if (!category) throw new NotFoundError('Category not found');
  return category;
}

/** Trimmed text, or null when it is blank. */
function normalizedText(value: null | string | undefined): null | string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** An account the member can see: the household's shared one, or their own private one. */
async function visibleAccountOrThrow(em: EntityManager, actor: TransactionTemplateActor, accountKey: number): Promise<Account> {
  const account = await em.findOne(Account, {
    ...visibleAccountWhere(actor.appuserKey),
    accountKey,
    deletedAt: null,
    tenantKey: getRef(em, Tenant, actor.tenantKey),
  });
  if (!account) throw new NotFoundError('Account not found');
  return account;
}

/** A merchant of the household, or a global one. Another household's merchant is a 404. */
async function visibleMerchantOrThrow(em: EntityManager, actor: TransactionTemplateActor, transactionMerchantKey: number): Promise<TransactionMerchant> {
  const merchant = await em.findOne(TransactionMerchant, {
    $or: [{ tenantKey: null }, { tenantKey: getRef(em, Tenant, actor.tenantKey) }],
    deletedAt: null,
    transactionMerchantKey,
  });
  if (!merchant) throw new NotFoundError('Merchant not found');
  return merchant;
}
