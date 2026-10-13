import { Migration } from '@mikro-orm/migrations';

/**
 * Widen share quantities and per-unit prices from `numeric(18,4)` to `numeric(18,8)`.
 *
 * ## Why this exists separately from Migration20260915190000
 *
 * `Migration20260915190000` originally narrowed these four columns to the money scale,
 * `numeric(18,4)`. That was wrong: a quantity is not money. A fractional-share or crypto
 * position legitimately carries up to 8 decimal places, and rounding `0.00235159` to
 * `0.0024` is a 2.1% error on a real holding — applied silently, because `round()` does not
 * complain about the precision it discards.
 *
 * It was not caught in review, on a scratch database, or on staging, because none of them
 * hold real broker imports — all three reported zero affected rows. It was caught by running
 * the pre-flight against **production**, which holds 37 such quantities. That migration has
 * since been corrected, so any database that has not yet applied it gets `numeric(18,8)`
 * directly and this migration is a no-op there.
 *
 * Staging is the database that needs this one: it applied the original scale-4 version
 * during the deploy-failure window, before the hold-back existed. Widening a `numeric`
 * scale is lossless, so this simply restores the headroom. Staging held no value with more
 * than 4dp, so nothing was lost there either — but the *column* has to be right before the
 * next portfolio import lands on it.
 *
 * ## Not transactional, and why that is fine here
 *
 * Unlike the narrowing, widening cannot fail on data: every existing value already fits.
 * It still rewrites the table and takes ACCESS EXCLUSIVE, but `financial_transaction` is
 * small (hundreds of rows in both environments), so the window is negligible.
 */
export class Migration20260916100000 extends Migration {
  override async down(): Promise<void> {
    this.addSql(`set local lock_timeout = '5s';`);
    // Deliberately lossy in reverse — going back to 4dp discards the precision this
    // migration exists to preserve. Present for completeness, not because reverting is safe.
    this.addSql(`alter table "financial_transaction"
      alter column "quantity" type numeric(18,4) using round("quantity", 4),
      alter column "original_unit_amount" type numeric(18,4) using round("original_unit_amount", 4),
      alter column "settlement_unit_amount" type numeric(18,4) using round("settlement_unit_amount", 4),
      alter column "appuser_unit_amount" type numeric(18,4) using round("appuser_unit_amount", 4);`);
  }

  override async up(): Promise<void> {
    this.addSql(`set local lock_timeout = '5s';`);
    // No `round()` on the way up: widening never needs to discard anything.
    this.addSql(`alter table "financial_transaction"
      alter column "quantity" type numeric(18,8),
      alter column "original_unit_amount" type numeric(18,8),
      alter column "settlement_unit_amount" type numeric(18,8),
      alter column "appuser_unit_amount" type numeric(18,8);`);
  }
}
