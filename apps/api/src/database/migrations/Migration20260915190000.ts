import { Migration } from '@mikro-orm/migrations';

/**
 * Constrain the previously-unbounded money columns to an explicit scale.
 *
 * ## Why
 *
 * `Transaction` and `FinancialTransaction` declared their money columns as bare `numeric`
 * — no precision, no scale. MikroORM's `DecimalType` has no `convertToDatabaseValue`, so
 * the raw JS double was stringified and handed to node-postgres, and an unconstrained
 * `numeric` stores all 17 significant digits verbatim. That is how values like
 * `-121.61000000000001` came to be persisted. The `numeric(18,4)` columns elsewhere were
 * accidentally protected, because Postgres rounds to scale on write.
 *
 * With the arithmetic now exact (`utils/money.ts`), new writes are already rounded to
 * scale, so this migration is the second half of the same fix: it makes the *storage*
 * incapable of holding noise, and it rounds the noise already sitting in existing rows.
 *
 * A second, quieter consequence is fixed too: `DecimalType.format()` returns `+val` when
 * `prop.scale == null`, and `compareValues` uses `format`, so MikroORM's dirty-check was
 * comparing raw doubles on these columns and emitting spurious UPDATEs on read-modify-write.
 *
 * ## Scales
 *
 * - Amounts and balances → `numeric(18,4)`, matching `account.balance`, which was already
 *   the de-facto house standard.
 * - Exchange rates → `numeric(18,8)`. Rates need more scale than amounts; rounding a rate
 *   to 4dp would itself introduce conversion error.
 * - **Share quantities and per-unit prices → `numeric(18,8)`.** These are not money and
 *   must not be given the money scale — see below.
 *
 * ## Why `quantity` is not 4dp (caught on production data, not in review)
 *
 * The first version of this migration narrowed `financial_transaction.quantity` and the
 * three `*_unit_amount` columns to `numeric(18,4)` along with everything else. A scratch
 * database and staging both reported zero affected rows, because neither holds real broker
 * imports. Production holds 37 quantities that would have changed, and they are **not**
 * float noise:
 *
 *     0.00235159   0.01799149   0.03835   0.49833887   3.51864883   10.21059349
 *
 * Every money column's excess precision has the unmistakable float-accumulation signature —
 * 11 to 31 decimal places, deltas around 5e-5 on values in the thousands (`2728.8664508842962`
 * for a balance). Rounding those to 4dp is the *correction*. `quantity` has no such
 * signature: it tops out at exactly 8 decimal places, which is what a broker reports for a
 * fractional share or crypto position. Rounding `0.00235159` to `0.0024` is a 2.1% error on
 * a real holding, and it would have been silent — `round()` does not complain.
 *
 * So quantities and per-unit prices get `numeric(18,8)`, the same scale as rates. 8dp covers
 * every fractional-share broker and the crypto precision actually present. A token quoted
 * with more than 8dp would still truncate; there is none in the data today, and the
 * pre-flight (`database/scripts/preflight-held-migrations.sql`) is what would catch one
 * before it mattered.
 *
 * ## Operational note — this takes ACCESS EXCLUSIVE
 *
 * `ALTER COLUMN … TYPE` rewrites the table and holds ACCESS EXCLUSIVE for the duration.
 * On a large `transaction` table this is a blocking operation, so apply it in a
 * maintenance window rather than letting it run on container startup. The team already
 * applies constraint-changing migrations manually ahead of the code deploy (see CLAUDE.md);
 * this is one of those. `lock_timeout` is set so it fails fast rather than queueing behind
 * — and then blocking — live traffic.
 *
 * The narrowing is value-safe for the money columns: their excess precision is float noise
 * and rounding it away is the point. It is **not** automatically safe for anything that is
 * not money, which is what the `quantity` case above cost to learn. Run the pre-flight
 * against the target database first.
 */
export class Migration20260915190000 extends Migration {
  override async down(): Promise<void> {
    this.addSql(`set local lock_timeout = '5s';`);

    this.addSql(`alter table "transaction"
      alter column "original_amount" type numeric using "original_amount"::numeric,
      alter column "edited_settlement_amount" type numeric using "edited_settlement_amount"::numeric,
      alter column "settlement_amount" type numeric using "settlement_amount"::numeric,
      alter column "appuser_settlement_amount" type numeric using "appuser_settlement_amount"::numeric,
      alter column "balance" type numeric using "balance"::numeric,
      alter column "settlement_exchange_rate" type numeric using "settlement_exchange_rate"::numeric,
      alter column "appuser_currency_exchange_rate" type numeric using "appuser_currency_exchange_rate"::numeric;`);

    this.addSql(`alter table "financial_transaction"
      alter column "original_amount" type numeric using "original_amount"::numeric,
      alter column "original_unit_amount" type numeric using "original_unit_amount"::numeric,
      alter column "quantity" type numeric using "quantity"::numeric,
      alter column "settlement_amount" type numeric using "settlement_amount"::numeric,
      alter column "settlement_unit_amount" type numeric using "settlement_unit_amount"::numeric,
      alter column "appuser_settlement_amount" type numeric using "appuser_settlement_amount"::numeric,
      alter column "appuser_unit_amount" type numeric using "appuser_unit_amount"::numeric,
      alter column "fee_amount" type numeric using "fee_amount"::numeric,
      alter column "settlement_exchange_rate" type numeric using "settlement_exchange_rate"::numeric,
      alter column "appuser_currency_exchange_rate" type numeric using "appuser_currency_exchange_rate"::numeric;`);
  }

  override async up(): Promise<void> {
    // Fail fast instead of queueing behind live traffic and then blocking it.
    this.addSql(`set local lock_timeout = '5s';`);

    // Amounts and balances: 4dp, matching `account.balance`.
    this.addSql(`alter table "transaction"
      alter column "original_amount" type numeric(18,4) using round("original_amount", 4),
      alter column "edited_settlement_amount" type numeric(18,4) using round("edited_settlement_amount", 4),
      alter column "settlement_amount" type numeric(18,4) using round("settlement_amount", 4),
      alter column "appuser_settlement_amount" type numeric(18,4) using round("appuser_settlement_amount", 4),
      alter column "balance" type numeric(18,4) using round("balance", 4);`);

    // Rates: more scale than amounts.
    this.addSql(`alter table "transaction"
      alter column "settlement_exchange_rate" type numeric(18,8) using round("settlement_exchange_rate", 8),
      alter column "appuser_currency_exchange_rate" type numeric(18,8) using round("appuser_currency_exchange_rate", 8);`);

    this.addSql(`alter table "financial_transaction"
      alter column "original_amount" type numeric(18,4) using round("original_amount", 4),
      alter column "settlement_amount" type numeric(18,4) using round("settlement_amount", 4),
      alter column "appuser_settlement_amount" type numeric(18,4) using round("appuser_settlement_amount", 4),
      alter column "fee_amount" type numeric(18,4) using round("fee_amount", 4);`);

    // Quantities and per-unit prices: 8dp, NOT the money scale. A fractional-share or crypto
    // quantity legitimately carries up to 8 decimal places, and production holds 37 of them
    // (0.00235159 … 10.21059349). Rounding those to 4dp silently corrupts real positions —
    // see the header. Per-unit prices ride along for the same reason: the price of a
    // fractional unit needs the scale the fraction does.
    this.addSql(`alter table "financial_transaction"
      alter column "quantity" type numeric(18,8) using round("quantity", 8),
      alter column "original_unit_amount" type numeric(18,8) using round("original_unit_amount", 8),
      alter column "settlement_unit_amount" type numeric(18,8) using round("settlement_unit_amount", 8),
      alter column "appuser_unit_amount" type numeric(18,8) using round("appuser_unit_amount", 8);`);

    this.addSql(`alter table "financial_transaction"
      alter column "settlement_exchange_rate" type numeric(18,8) using round("settlement_exchange_rate", 8),
      alter column "appuser_currency_exchange_rate" type numeric(18,8) using round("appuser_currency_exchange_rate", 8);`);
  }
}
