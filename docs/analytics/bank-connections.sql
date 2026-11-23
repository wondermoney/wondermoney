-- Bank connection health: each step of connecting a bank, per week and provider, over the last
-- 12 weeks. `started` and `abandoned` come from the apps, only with the person's analytics
-- opt-in, and are not tied to an account; `completed` and the failures come from the server for
-- everyone. So the steps can't be read as one funnel: compare each week's `completed` with its
-- failures, and watch `started` and `abandoned` for their trend.
SELECT
  toStartOfWeek(timestamp, 1) AS week,
  coalesce(properties.provider, 'unknown') AS provider,
  countIf(event = 'bank_connection_started') AS started,
  countIf(event = 'bank_connection_abandoned') AS abandoned,
  countIf(event = 'bank_connection_completed') AS completed,
  countIf(event = 'bank_connection_failed' AND properties.step = 'start') AS failed_to_start,
  countIf(event = 'bank_connection_failed' AND coalesce(properties.step, 'link') = 'link') AS failed_to_link
FROM events
WHERE event IN ('bank_connection_started', 'bank_connection_abandoned', 'bank_connection_completed', 'bank_connection_failed')
  AND timestamp >= toStartOfWeek(now() - INTERVAL 12 WEEK, 1)
GROUP BY week, provider
ORDER BY week, provider
LIMIT 1000
