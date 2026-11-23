-- Bank syncs per week, over the last 12 weeks: those that fully succeeded, failures that will be
-- retried, and incidents (a partial or failed sync with no retry left, `final`). `initial-add` is
-- a new connection's first sync, `scheduled-refresh` a later one.
SELECT
  toStartOfWeek(timestamp, 1) AS week,
  properties.flow AS flow,
  countIf(properties.result = 'full_success') AS succeeded,
  countIf(properties.result != 'full_success' AND toString(properties.final) != 'true') AS retried,
  countIf(properties.result = 'partial' AND toString(properties.final) = 'true') AS partial,
  countIf(properties.result = 'failed' AND toString(properties.final) = 'true') AS failed
FROM events
WHERE event IN ('account_add_sync_failed', 'account_sync_succeeded', 'bank_sync_completed')
  AND timestamp >= toStartOfWeek(now() - INTERVAL 12 WEEK, 1)
GROUP BY week, flow
ORDER BY week, flow
LIMIT 1000
