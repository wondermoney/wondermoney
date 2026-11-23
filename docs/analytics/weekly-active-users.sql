-- Weekly active users: people with a `user_active` day in the week, by the client they used,
-- over the last 26 weeks. A person who used two clients in a week counts once in `total` and
-- once in each client's column.
SELECT
  toStartOfWeek(timestamp, 1) AS week,
  count(DISTINCT distinct_id) AS total,
  count(DISTINCT if(properties.platform = 'web', distinct_id, NULL)) AS web,
  count(DISTINCT if(properties.platform = 'mobile', distinct_id, NULL)) AS mobile,
  count(DISTINCT if(properties.platform = 'api', distinct_id, NULL)) AS api
FROM events
WHERE event = 'user_active'
  AND timestamp >= toStartOfWeek(now() - INTERVAL 26 WEEK, 1)
GROUP BY week
ORDER BY week
LIMIT 1000
