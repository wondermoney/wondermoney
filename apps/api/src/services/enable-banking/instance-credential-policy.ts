import type { EntityManager } from '@mikro-orm/postgresql';
import { sql } from 'kysely';

import { sqlQuery } from '@app/database/sql';
import { hasEnableBankingProductionContract } from '@config/enable-banking-instance';
import { TenantType } from '@entity/Tenant';

import { instanceEnableBankingCredential } from './instance-credential';

/**
 * Who may link a bank with the instance-wide Enable Banking credential.
 *
 * Enable Banking's Restricted Production mode lets an application link only its owner's own
 * accounts, so without a full production contract the instance credential serves one household:
 *
 *  - `ENABLE_BANKING_PRODUCTION_CONTRACT=true`: every regular household may use it.
 *  - Otherwise, the household that first linked a bank with it keeps it, for new links and
 *    reconnections alike, however many households sign up later. Every other household needs
 *    its own credential.
 *  - Before anyone has linked with it, it is available only while the instance has exactly one
 *    household with active members. A second household signing up first leaves it unused until
 *    the operator declares a contract.
 *
 * The demo household never gets it and never counts. A connection already made with the instance
 * credential keeps syncing with it whatever happens later: this rule only decides new links.
 *
 * These queries read across households on purpose (the instance-wide count), so they run outside
 * the tenant filter and return nothing about any household but whether it is the caller's.
 */

/**
 * True when a new link in this household may use the instance credential. Whether Enable Banking
 * is enabled at all (`BANK_PROVIDERS`) is the registry's question, asked by its callers.
 */
export async function mayUseInstanceEnableBankingCredential(em: EntityManager, tenantKey: number): Promise<boolean> {
  if (!instanceEnableBankingCredential()) return false;
  const db = sqlQuery(em);

  const tenant = await db.selectFrom('tenant').select('tenant_type').where('tenant_key', '=', tenantKey).where('deleted_at', 'is', null).executeTakeFirst();
  if (!tenant || tenant.tenant_type === TenantType.DEMO) return false;
  if (hasEnableBankingProductionContract()) return true;

  const hasActiveMembers = sql<boolean>`exists (
    select 1 from appuser_tenant m
    join appuser u on u.appuser_key = m.appuser_key
    where m.tenant_key = t.tenant_key and m.record_active and m.deleted_at is null and u.record_active and u.deleted_at is null
  )`;
  const regularHousehold = sql<boolean>`t.tenant_type = ${TenantType.REGULAR} and t.record_active and t.deleted_at is null and ${hasActiveMembers}`;

  // The household that first linked with the instance credential, deleted connections included:
  // removing a connection does not hand the credential to someone else.
  const first = await db
    .selectFrom('enable_banking_connection as c')
    .innerJoin('tenant as t', 't.tenant_key', 'c.tenant_key')
    .select('c.tenant_key')
    .where('c.enable_banking_credential_key', 'is', null)
    .where(regularHousehold)
    .orderBy('c.created_at', 'asc')
    .orderBy('c.enable_banking_connection_key', 'asc')
    .limit(1)
    .executeTakeFirst();
  if (first) return Number(first.tenant_key) === tenantKey;

  const households = await db.selectFrom('tenant as t').select('t.tenant_key').where(regularHousehold).limit(2).execute();
  return households.length === 1 && Number(households[0]?.tenant_key) === tenantKey;
}
