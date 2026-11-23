-- Why bank connections fail, by provider and step, over the last 12 weeks.
SELECT
  properties.provider AS provider,
  coalesce(properties.step, 'link') AS step,
  properties.reason AS reason,
  count() AS failures
FROM events
WHERE event = 'bank_connection_failed'
  AND timestamp >= toStartOfWeek(now() - INTERVAL 12 WEEK, 1)
GROUP BY provider, step, reason
ORDER BY failures DESC
LIMIT 1000
