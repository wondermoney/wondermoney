import { UniqueConstraintViolationException } from '@mikro-orm/core';
import type { EntityManager } from '@mikro-orm/postgresql';

import { HIDDEN_FILTER } from '@app/database/filters/tenant-filter';
import { Appuser } from '@entity/Appuser';
import { Tag } from '@entity/Tag';
import { Tenant } from '@entity/Tenant';
import { Transaction } from '@entity/Transaction';
import { TransactionAuditActorType, TransactionAuditEventType } from '@entity/TransactionAuditLog';
import { TransactionTag } from '@entity/TransactionTag';
import { TransactionAuditService } from '@service/transaction/transaction-audit.service';
import { getRef } from '@utils/em-helpers';
import { BadRequestError, ConflictError, ERROR_CODE, NotFoundError } from '@utils/errors';
import { MAX_TAGS_PER_TRANSACTION } from '@validators/tag';

/**
 * Household tags and the tags on transactions.
 *
 * Every read and write is scoped twice: by the explicit tenant passed in, and by the request's
 * tenant filter. A transaction is looked up through the `Transaction` filter, so a member can
 * only tag what they can see: never another household's rows, nor the other member's
 * private-account rows.
 */

/** Neutral grey, readable as a chip background in light and dark themes. */
const DEFAULT_TAG_COLOR = '#94a3b8';

export interface TagDto {
  color: string;
  name: string;
  tagKey: number;
}

interface Actor {
  appuserKey: number;
  tenantKey: number;
}

export const toTagDto = (tag: Tag): TagDto => ({ color: tag.color, name: tag.name, tagKey: tag.tagKey });

/** By name ignoring case, then by key, so the order is stable. */
export const compareTags = (a: TagDto, b: TagDto) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.tagKey - b.tagKey;

const ascending = (a: number, b: number) => a - b;

export async function createTag(em: EntityManager, actor: Actor, input: { color?: string; name: string }): Promise<TagDto> {
  await assertNameFree(em, actor.tenantKey, input.name);
  const tag = new Tag();
  tag.color = input.color ?? DEFAULT_TAG_COLOR;
  tag.createdByAppuserKey = getRef(em, Appuser, actor.appuserKey);
  tag.name = input.name;
  tag.tenantKey = getRef(em, Tenant, actor.tenantKey);
  em.persist(tag);
  await flushOrConflict(em);
  return toTagDto(tag);
}

export async function listTags(em: EntityManager, tenantKey: number): Promise<TagDto[]> {
  const tags = await em.find(Tag, { deletedAt: null, tenantKey: getRef(em, Tenant, tenantKey) });
  return tags.map(toTagDto).sort(compareTags);
}

export async function updateTag(em: EntityManager, actor: Actor, tagKey: number, input: { color?: string; name?: string }): Promise<TagDto> {
  const tag = await findLiveTag(em, actor.tenantKey, tagKey);
  if (input.name !== undefined && input.name !== tag.name) {
    await assertNameFree(em, actor.tenantKey, input.name, tag.tagKey);
    tag.name = input.name;
  }
  if (input.color !== undefined) tag.color = input.color;
  await flushOrConflict(em);
  return toTagDto(tag);
}

/**
 * Soft-delete a tag and take it off every transaction of the household, including rows the
 * deleting member cannot see (the other member's private accounts): a deleted tag must not
 * linger anywhere. Each affected transaction gets an audit entry.
 */
export async function deleteTag(em: EntityManager, actor: Actor, tagKey: number): Promise<void> {
  await findLiveTag(em, actor.tenantKey, tagKey);
  await em.transactional(async (txEm) => {
    const tenant = getRef(txEm, Tenant, actor.tenantKey);
    // Filters off on purpose (see above); the tenant and the tag scope the rows explicitly.
    const links = await txEm.find(TransactionTag, { tagKey: getRef(txEm, Tag, tagKey), tenantKey: tenant }, { filters: false, populate: ['transactionKey'] });
    const transactions = links.map((link) => link.transactionKey);
    const before = await tagKeysByTransaction(txEm, tenant, transactions);
    for (const transaction of transactions) {
      const from = before.get(transaction.transactionKey) ?? [];
      await TransactionAuditService.log(txEm, auditEntry(actor, transaction, from, from.filter((key) => key !== tagKey), 'tag-delete'), { flush: false });
    }
    await txEm.nativeDelete(TransactionTag, { tagKey: getRef(txEm, Tag, tagKey), tenantKey: tenant }, { filters: false });
    const tag = await txEm.findOneOrFail(Tag, { tagKey, tenantKey: tenant });
    tag.deletedAt = new Date();
    await txEm.flush();
  });
}

/**
 * The live tags of the household with these keys, or a 404 when any key is unknown, deleted
 * or belongs to another household (indistinguishable on purpose).
 */
export async function resolveTags(em: EntityManager, tenantKey: number, tagKeys: number[]): Promise<Tag[]> {
  const unique = [...new Set(tagKeys)];
  if (unique.length === 0) return [];
  const tags = await em.find(Tag, { deletedAt: null, tagKey: { $in: unique }, tenantKey: getRef(em, Tenant, tenantKey) });
  if (tags.length !== unique.length) throw new NotFoundError('Tag not found');
  return tags;
}

/** Persist links from a transaction to tags it does not carry yet; the caller flushes. */
export function linkTags(em: EntityManager, transaction: Transaction, tags: Tag[]): void {
  for (const tag of tags) {
    const link = new TransactionTag();
    link.tagKey = tag;
    link.tenantKey = tag.tenantKey;
    link.transactionKey = transaction;
    em.persist(link);
  }
}

/**
 * Replace a transaction's tags with exactly `tagKeys`. 404 when the member cannot see the
 * transaction or a tag is not one of the household's live tags. Audited when anything changed.
 */
export async function setTransactionTags(em: EntityManager, actor: Actor, transactionKey: number, tagKeys: number[]): Promise<TagDto[]> {
  const tenant = getRef(em, Tenant, actor.tenantKey);
  // A revealed hidden transaction must stay taggable: only the hidden filter is turned off; the
  // tenant filter and its private-account carve-out stay on.
  const transaction = await em.findOne(Transaction, { deletedAt: null, tenantKey: tenant, transactionKey }, { filters: { [HIDDEN_FILTER]: false } });
  if (!transaction) throw new NotFoundError('Transaction not found');
  const tags = await resolveTags(em, actor.tenantKey, tagKeys);

  const current = await em.find(TransactionTag, { tenantKey: tenant, transactionKey: transaction });
  const wanted = new Set(tags.map((tag) => tag.tagKey));
  const kept = new Set<number>();
  for (const link of current) {
    if (wanted.has(link.tagKey.tagKey)) kept.add(link.tagKey.tagKey);
    else em.remove(link);
  }
  linkTags(em, transaction, tags.filter((tag) => !kept.has(tag.tagKey)));

  const from = current.map((link) => link.tagKey.tagKey).sort(ascending);
  const to = [...wanted].sort(ascending);
  if (from.length !== to.length || from.some((key, index) => key !== to[index])) {
    await TransactionAuditService.log(em, auditEntry(actor, transaction, from, to, 'transaction-tags'), { flush: false });
  }
  await em.flush();
  return tags.map(toTagDto).sort(compareTags);
}

/**
 * Add and remove tags on many transactions at once (a bulk change). The caller has already loaded
 * `transactions` through the tenant filter, so every row is one the member can see; the tags must be
 * live tags of the household (404 otherwise). A row that already carries a tag being added, or does
 * not carry one being removed, is left as it is. Returns each changed row's tag keys before and
 * after, for its audit entry; unchanged rows are absent. The caller flushes.
 */
export async function changeTransactionTags(
  em: EntityManager,
  actor: Actor,
  transactions: Transaction[],
  change: { add: number[]; remove: number[] },
): Promise<Map<number, { from: number[]; to: number[] }>> {
  const changes = new Map<number, { from: number[]; to: number[] }>();
  if (transactions.length === 0 || (change.add.length === 0 && change.remove.length === 0)) return changes;
  const tenant = getRef(em, Tenant, actor.tenantKey);
  const adding = await resolveTags(em, actor.tenantKey, change.add);
  const removing = new Set(change.remove);
  if (removing.size > 0) await resolveTags(em, actor.tenantKey, change.remove);

  const links = await em.find(TransactionTag, { tenantKey: tenant, transactionKey: { $in: transactions } });
  const linksByTransaction = new Map<number, TransactionTag[]>();
  for (const link of links) {
    const key = link.transactionKey.transactionKey;
    linksByTransaction.set(key, [...(linksByTransaction.get(key) ?? []), link]);
  }

  // Planned for every row before anything is written, so a row that would go over the limit
  // refuses the whole request rather than leaving it half applied.
  const plans = transactions.map((transaction) => {
    const current = linksByTransaction.get(transaction.transactionKey) ?? [];
    const from = current.map((link) => link.tagKey.tagKey).sort(ascending);
    const missing = adding.filter((tag) => !from.includes(tag.tagKey));
    const to = [...from.filter((key) => !removing.has(key)), ...missing.map((tag) => tag.tagKey)].sort(ascending);
    return { current, from, missing, to, transaction };
  });
  if (plans.some((plan) => plan.to.length > MAX_TAGS_PER_TRANSACTION)) throw new BadRequestError(`A transaction can carry at most ${MAX_TAGS_PER_TRANSACTION} tags`);

  for (const { current, from, missing, to, transaction } of plans) {
    for (const link of current) if (removing.has(link.tagKey.tagKey)) em.remove(link);
    linkTags(em, transaction, missing);
    if (from.length !== to.length || from.some((key, index) => key !== to[index])) changes.set(transaction.transactionKey, { from, to });
  }
  return changes;
}

function auditEntry(actor: Actor, transaction: Transaction, from: number[], to: number[], source: string) {
  return {
    accountKey: transaction.accountKey?.accountKey ?? null,
    actorAppuserKey: actor.appuserKey,
    actorType: TransactionAuditActorType.USER,
    appuserKey: transaction.appuserKey?.appuserKey ?? actor.appuserKey,
    changes: { tagKeys: { from, to } },
    eventType: TransactionAuditEventType.USER_EDIT,
    source,
    tenantKey: actor.tenantKey,
    transactionKey: transaction.transactionKey,
  };
}

/** Every tag key on each of these transactions, read with filters off (see `deleteTag`). */
async function findLiveTag(em: EntityManager, tenantKey: number, tagKey: number): Promise<Tag> {
  const tag = await em.findOne(Tag, { deletedAt: null, tagKey, tenantKey: getRef(em, Tenant, tenantKey) });
  if (!tag) throw new NotFoundError('Tag not found');
  return tag;
}

async function tagKeysByTransaction(em: EntityManager, tenant: Tenant, transactions: Transaction[]): Promise<Map<number, number[]>> {
  const byTransaction = new Map<number, number[]>();
  if (transactions.length === 0) return byTransaction;
  const links = await em.find(TransactionTag, { tenantKey: tenant, transactionKey: { $in: transactions } }, { filters: false });
  for (const link of links) {
    const key = link.transactionKey.transactionKey;
    byTransaction.set(key, [...(byTransaction.get(key) ?? []), link.tagKey.tagKey].sort(ascending));
  }
  return byTransaction;
}

/** Names are unique per household ignoring case. The partial unique index is the final word. */
async function assertNameFree(em: EntityManager, tenantKey: number, name: string, exceptTagKey?: number): Promise<void> {
  const lower = name.toLocaleLowerCase();
  const tags = await em.find(Tag, { deletedAt: null, tenantKey: getRef(em, Tenant, tenantKey) });
  if (tags.some((tag) => tag.tagKey !== exceptTagKey && tag.name.toLocaleLowerCase() === lower)) {
    throw new ConflictError('A tag with this name already exists', ERROR_CODE.TAG_NAME_TAKEN);
  }
}

async function flushOrConflict(em: EntityManager): Promise<void> {
  try {
    await em.flush();
  } catch (error) {
    if (error instanceof UniqueConstraintViolationException) throw new ConflictError('A tag with this name already exists', ERROR_CODE.TAG_NAME_TAKEN);
    throw error;
  }
}
