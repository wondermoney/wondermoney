-- Retention by signup week: of the people who signed up in a week, the share with a
-- `user_active` day in the 4th and in the 12th week after it (the signup week is week 0).
-- A week shows NULL for a cohort that has not reached it yet, or reached it before
-- `user_active` existed (it is recorded from 2026-11-22, so 2026-11-23 is the first full week).
WITH
  cohorts AS (
    SELECT distinct_id, toStartOfWeek(min(timestamp), 1) AS cohort_week
    FROM events
    WHERE event = 'signup'
      AND timestamp >= toStartOfWeek(now() - INTERVAL 26 WEEK, 1)
    GROUP BY distinct_id
  ),
  activity AS (
    SELECT DISTINCT distinct_id, toStartOfWeek(timestamp, 1) AS active_week
    FROM events
    WHERE event = 'user_active'
      AND timestamp >= toStartOfWeek(now() - INTERVAL 26 WEEK, 1)
      AND distinct_id IN (SELECT distinct_id FROM cohorts)
  ),
  returned AS (
    SELECT
      c.distinct_id AS distinct_id,
      c.cohort_week AS cohort_week,
      countIf(dateDiff('week', c.cohort_week, a.active_week) = 4) > 0 AS week_4,
      countIf(dateDiff('week', c.cohort_week, a.active_week) = 12) > 0 AS week_12
    FROM cohorts AS c
    LEFT JOIN activity AS a ON a.distinct_id = c.distinct_id
    GROUP BY distinct_id, cohort_week
  )
SELECT
  cohort_week,
  count() AS signups,
  if(cohort_week + INTERVAL 5 WEEK <= now() AND cohort_week + INTERVAL 4 WEEK >= toDate('2026-11-23'),
    round(100 * countIf(week_4) / count(), 1), NULL) AS week_4_pct,
  if(cohort_week + INTERVAL 13 WEEK <= now() AND cohort_week + INTERVAL 12 WEEK >= toDate('2026-11-23'),
    round(100 * countIf(week_12) / count(), 1), NULL) AS week_12_pct
FROM returned
GROUP BY cohort_week
ORDER BY cohort_week
LIMIT 1000
