-- Why bank syncs end in an incident (partial or failed, no retry left), by flow, kind and code,
-- over the last 12 weeks.
SELECT
  properties.flow AS flow,
  properties.error_category AS error_category,
  properties.error_code AS error_code,
  count() AS incidents
FROM events
WHERE event IN ('account_add_sync_failed', 'account_sync_succeeded', 'bank_sync_completed')
  AND properties.result != 'full_success'
  AND toString(properties.final) = 'true'
  AND timestamp >= toStartOfWeek(now() - INTERVAL 12 WEEK, 1)
GROUP BY flow, error_category, error_code
ORDER BY incidents DESC
LIMIT 1000
