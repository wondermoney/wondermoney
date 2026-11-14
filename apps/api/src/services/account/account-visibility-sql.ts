/**
 * The account visibility rule as SQL, for hand-written queries and Kysely, which bypass the tenant
 * filter. Kept free of entity and service imports so the SQL helpers that entities use
 * (`reimbursement-sql.ts`) can import it. The rule itself is described in `account-access.ts`.
 */
function integer(value: number, name: string): string {
  if (!Number.isSafeInteger(value)) throw new TypeError(`${name} must be an integer`);
  return String(value);
}

function tableAlias(alias: string): string {
  if (!/^[a-z_]\w*$/i.test(alias)) throw new TypeError(`Not a table alias: ${alias}`);
  return `"${alias}"`;
}

/**
 * SQL: the account aliased `alias` is visible to `appuserKey`. For raw SQL and Kysely, which bypass
 * the tenant filter; the caller adds the tenant condition. The key is inlined, validated as an
 * integer, and `alias` is a table alias written by the caller, never input.
 */
export function visibleAccountSql(alias: string, appuserKey: number): string {
  const account = tableAlias(alias);
  const viewer = integer(appuserKey, 'appuserKey');
  return `(${account}."is_private" = false or ${account}."account_owner_appuser_key" = ${viewer} or exists (select 1 from "account_share" visible_share where visible_share."account_key" = ${account}."account_key" and visible_share."appuser_key" = ${viewer} and visible_share."deleted_at" is null))`;
}

/**
 * SQL: who sees the account aliased `alias`, as one comparable text: `*` for a shared account, else
 * the sorted keys of its owner and the members it is shared with. Two accounts with the same text
 * are seen by exactly the same members, which is when a link between them (a transfer pair, a
 * reimbursement) may count without showing one account's money to someone who cannot see it.
 */
export function accountAudienceSql(alias: string): string {
  const account = tableAlias(alias);
  return `(case when ${account}."is_private" = false then '*' else coalesce((select string_agg(audience.member::text, ',' order by audience.member) from (select ${account}."account_owner_appuser_key" as member union select audience_share."appuser_key" from "account_share" audience_share where audience_share."account_key" = ${account}."account_key" and audience_share."deleted_at" is null) audience where audience.member is not null), '') end)`;
}
