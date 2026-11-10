import type { EntityManager } from '@mikro-orm/postgresql';

/**
 * Give every account without an opening balance the one it can be derived from, and return how
 * many accounts changed.
 *
 * Accounts created before `Account.openingBalance` existed have none, so net worth history could
 * not count them before their first transaction. The opening balance is:
 *   - with settled rows: the balance before the oldest one in chain order
 *     (`balance - settlementAmount` of the first BOOKED, dated row; see `balance-chain.service.ts`);
 *   - with none: the balance the account holds now (a manual account's typed balance, or a synced
 *     account's provider balance).
 * Either way it is dated when the account was created. An account whose oldest row carries no
 * stored balance is left without one: there is nothing exact to derive it from.
 *
 * Only accounts whose opening balance is null are written, so it is idempotent and never
 * overwrites a balance a user typed or a sync recorded. `migrate.ts` runs it after the
 * migrations on every start; once every account has one it updates nothing.
 *
 * Raw SQL with no tenant predicate on purpose: a system pass over every household, outside any
 * request's tenant context, that reads and writes each account's own rows only.
 */
export async function backfillAccountOpeningBalances(em: EntityManager): Promise<number> {
  const result = await em.getConnection().execute<{ affectedRows: number }>(
    `with derived as (
       select a."account_key",
              case when first_row."transaction_key" is null then a."balance"
                   else first_row."balance" - coalesce(first_row."settlement_amount", 0) end as opening_balance
       from "account" a
       left join lateral (
         select t."transaction_key", t."balance", t."settlement_amount"
         from "transaction" t
         join "transaction_status" ts on ts."transaction_status_key" = t."transaction_status_key"
         where t."account_key" = a."account_key"
           and ts."name" = 'BOOKED'
           and t."transaction_date" is not null
         order by t."transaction_date" asc, t."transaction_key" asc
         limit 1
       ) first_row on true
       where a."opening_balance" is null
     )
     update "account"
     set "opening_balance" = derived.opening_balance,
         "opening_balance_date" = "account"."created_at"
     from derived
     where "account"."account_key" = derived."account_key"
       and derived.opening_balance is not null`,
    [],
    'run',
  );
  return result.affectedRows;
}
