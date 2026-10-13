-- Pre-flight for the three held migrations (Migration2026091519{0000,0100,0200}).
--
-- READ-ONLY. Every statement here is a SELECT; nothing writes. Safe to run against
-- production during normal traffic, and it should be run there *before* the maintenance
-- window, not during it.
--
--     psql "$PROD_URL" -f src/database/scripts/preflight-held-migrations.sql
--
-- ## Why this exists
--
-- Migration20260915190000 narrows bare `numeric` columns to `numeric(18,4)` (amounts) and
-- `numeric(18,8)` (rates) with `USING round(col, n)`. `round` does not fail on excess
-- precision — it silently discards it. An unconstrained `numeric` column can hold a value
-- with any number of decimal places, so if any live row carries more precision than the
-- target scale, applying the migration destroys it with no error and no way to recover
-- short of a backup restore.
--
-- The chain has been verified end-to-end (up, down, and up again) against a scratch
-- PostgreSQL 16 database, so the DDL itself is known to apply cleanly. What a scratch
-- database cannot tell you is whether *your data* survives the rounding. That is what this
-- checks.
--
-- ## How to read the result
--
-- Every row returned by section 1 with a non-zero count is a column where at least one live
-- value would lose precision. **Expected: all zero.** If any is non-zero, do not run the
-- migration — first decide whether that precision is real or float round-tripping noise,
-- because the answer changes whether the fix is a wider scale or a deliberate rounding.
--
-- How to tell them apart, from the case that actually happened here. Run:
--
--     SELECT col::text, scale(col) FROM tbl WHERE col <> round(col, n) ORDER BY scale(col) DESC;
--
-- *Float noise* shows 11-31 decimal places and values that are obviously a near-miss of a
-- clean figure — `2728.8664508842962` for a balance, `1.6399999035000001` for 1.64. Rounding
-- those away is the whole point of the migration.
--
-- *Real precision* stops at a round number of decimal places and looks like something a
-- system deliberately reported — `0.00235159`, `10.21059349`, a broker's 8dp fractional
-- share quantity. Rounding that is silent data corruption.
--
-- This distinction is not hypothetical: `financial_transaction.quantity` was in the 4dp list
-- until production data showed 37 genuine 8dp quantities. Scratch and staging both reported
-- zero, because neither holds real broker imports. Only production could answer it.

\echo '=== 1. Values that would lose precision (expect zero rows) ==='

SELECT 'transaction.original_amount' AS col, count(*) AS rows_losing_precision
  FROM transaction WHERE original_amount IS NOT NULL AND original_amount <> round(original_amount, 4)
UNION ALL SELECT 'transaction.edited_settlement_amount', count(*)
  FROM transaction WHERE edited_settlement_amount IS NOT NULL AND edited_settlement_amount <> round(edited_settlement_amount, 4)
UNION ALL SELECT 'transaction.settlement_amount', count(*)
  FROM transaction WHERE settlement_amount IS NOT NULL AND settlement_amount <> round(settlement_amount, 4)
UNION ALL SELECT 'transaction.appuser_settlement_amount', count(*)
  FROM transaction WHERE appuser_settlement_amount IS NOT NULL AND appuser_settlement_amount <> round(appuser_settlement_amount, 4)
UNION ALL SELECT 'transaction.balance', count(*)
  FROM transaction WHERE balance IS NOT NULL AND balance <> round(balance, 4)
UNION ALL SELECT 'transaction.appuser_currency_balance', count(*)
  FROM transaction WHERE appuser_currency_balance IS NOT NULL AND appuser_currency_balance <> round(appuser_currency_balance, 4)
UNION ALL SELECT 'transaction.settlement_exchange_rate', count(*)
  FROM transaction WHERE settlement_exchange_rate IS NOT NULL AND settlement_exchange_rate <> round(settlement_exchange_rate, 8)
UNION ALL SELECT 'transaction.appuser_currency_exchange_rate', count(*)
  FROM transaction WHERE appuser_currency_exchange_rate IS NOT NULL AND appuser_currency_exchange_rate <> round(appuser_currency_exchange_rate, 8)
UNION ALL SELECT 'financial_transaction.original_amount', count(*)
  FROM financial_transaction WHERE original_amount IS NOT NULL AND original_amount <> round(original_amount, 4)
UNION ALL SELECT 'financial_transaction.original_unit_amount (8dp)', count(*)
  FROM financial_transaction WHERE original_unit_amount IS NOT NULL AND original_unit_amount <> round(original_unit_amount, 8)
UNION ALL SELECT 'financial_transaction.quantity (8dp)', count(*)
  FROM financial_transaction WHERE quantity IS NOT NULL AND quantity <> round(quantity, 8)
UNION ALL SELECT 'financial_transaction.settlement_amount', count(*)
  FROM financial_transaction WHERE settlement_amount IS NOT NULL AND settlement_amount <> round(settlement_amount, 4)
UNION ALL SELECT 'financial_transaction.settlement_unit_amount (8dp)', count(*)
  FROM financial_transaction WHERE settlement_unit_amount IS NOT NULL AND settlement_unit_amount <> round(settlement_unit_amount, 8)
UNION ALL SELECT 'financial_transaction.appuser_settlement_amount', count(*)
  FROM financial_transaction WHERE appuser_settlement_amount IS NOT NULL AND appuser_settlement_amount <> round(appuser_settlement_amount, 4)
UNION ALL SELECT 'financial_transaction.appuser_unit_amount (8dp)', count(*)
  FROM financial_transaction WHERE appuser_unit_amount IS NOT NULL AND appuser_unit_amount <> round(appuser_unit_amount, 8)
UNION ALL SELECT 'financial_transaction.fee_amount', count(*)
  FROM financial_transaction WHERE fee_amount IS NOT NULL AND fee_amount <> round(fee_amount, 4)
UNION ALL SELECT 'financial_transaction.settlement_exchange_rate', count(*)
  FROM financial_transaction WHERE settlement_exchange_rate IS NOT NULL AND settlement_exchange_rate <> round(settlement_exchange_rate, 8)
UNION ALL SELECT 'financial_transaction.appuser_currency_exchange_rate', count(*)
  FROM financial_transaction WHERE appuser_currency_exchange_rate IS NOT NULL AND appuser_currency_exchange_rate <> round(appuser_currency_exchange_rate, 8)
ORDER BY 2 DESC, 1;

\echo ''
\echo '=== 2. Values that would overflow numeric(18,n) (expect zero rows) ==='
-- Distinct from rounding: precision 18 with scale 4 allows at most 14 integer digits.
-- An overflow is a hard ERROR mid-ALTER, which is the partway failure that leaves a
-- database half-migrated. Rounding is silent; this is loud. Both are worth knowing first.

SELECT 'transaction.balance' AS col, count(*) AS rows_overflowing
  FROM transaction WHERE abs(balance) >= 10::numeric ^ 14
UNION ALL SELECT 'transaction.settlement_amount', count(*)
  FROM transaction WHERE abs(settlement_amount) >= 10::numeric ^ 14
UNION ALL SELECT 'financial_transaction.quantity', count(*)
  FROM financial_transaction WHERE abs(quantity) >= 10::numeric ^ 14
UNION ALL SELECT 'financial_transaction.settlement_amount', count(*)
  FROM financial_transaction WHERE abs(settlement_amount) >= 10::numeric ^ 14
ORDER BY 2 DESC, 1;

\echo ''
\echo '=== 3. Duplicates that would block the new partial unique indexes (expect zero rows) ==='
-- Migration20260915190200 adds UNIQUE indexes over *active* rows. If duplicates already
-- exist among active rows, CREATE UNIQUE INDEX fails. Because it runs CONCURRENTLY it
-- leaves an INVALID index behind on failure, which must be dropped before retrying —
-- so it is much cheaper to know now.

SELECT 'loan_repayment_link' AS tbl, count(*) AS duplicate_groups
FROM (
  SELECT loan_key, transaction_key
  FROM loan_repayment_link
  WHERE deleted_at IS NULL
  GROUP BY loan_key, transaction_key
  HAVING count(*) > 1
) d
UNION ALL
SELECT 'appuser_merchant_category', count(*)
FROM (
  SELECT appuser_key, transaction_merchant_key, category_key
  FROM appuser_merchant_category
  WHERE deleted_at IS NULL
  GROUP BY appuser_key, transaction_merchant_key, category_key
  HAVING count(*) > 1
) d;

\echo ''
\echo '=== 4. Any INVALID index left by a previous failed CONCURRENTLY run ==='
-- CREATE INDEX CONCURRENTLY leaves an invalid index behind when it fails. It is not used
-- for queries but it does consume writes, and a retry with the same name fails until it
-- is dropped.

SELECT c.relname AS invalid_index
FROM pg_index i
JOIN pg_class c ON c.oid = i.indexrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE NOT i.indisvalid AND n.nspname = 'public'
ORDER BY 1;

\echo ''
\echo '=== 5. Table sizes, to size the window ==='
-- The ALTERs rewrite both tables. Rewrite time scales with size, and the ALTER takes an
-- ACCESS EXCLUSIVE lock for its duration (with lock_timeout = 5s to acquire it, not to
-- hold it — once acquired, the rewrite runs to completion).

SELECT
  relname AS table_name,
  to_char(n_live_tup, 'FM999,999,999') AS approx_rows,
  pg_size_pretty(pg_total_relation_size(relid)) AS total_size
FROM pg_stat_user_tables
WHERE relname IN ('transaction', 'financial_transaction', 'loan_repayment_link', 'appuser_merchant_category')
ORDER BY pg_total_relation_size(relid) DESC;
