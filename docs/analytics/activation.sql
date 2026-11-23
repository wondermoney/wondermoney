-- Activation: of the people who signed up in the last 90 days, how many reached each step,
-- by the platform they signed up on and the website page they came from.
-- Each step counts people who also reached the steps before it, in any order after signup.
-- Week 2 is a `user_active` day 7 to 13 days after signup, counted only for people whose whole
-- week 2 is past and fell after `user_active` began on 2026-11-22 (`week_2_eligible`). Platform
-- is `unknown` for signups before that day too.
WITH
  signups AS (
    SELECT
      distinct_id,
      min(timestamp) AS signed_up_at,
      argMin(properties.landing_source, timestamp) AS landing_source,
      signed_up_at < now() - INTERVAL 14 DAY
        AND signed_up_at + INTERVAL 7 DAY >= toDateTime('2026-11-23 00:00:00') AS week_2_eligible
    FROM events
    WHERE event = 'signup'
      AND timestamp > now() - INTERVAL 90 DAY
    GROUP BY distinct_id
  ),
  reached AS (
    SELECT
      distinct_id,
      -- `signup` carries no platform: the first `user_active` of the person is the client
      -- that signed them up.
      argMinIf(properties.platform, timestamp, event = 'user_active') AS platform,
      countIf(event = 'first_account_created') > 0 AS has_account,
      countIf(event IN ('first_budget_created', 'first_goal_created')) > 0 AS has_plan
    FROM events
    WHERE event IN ('user_active', 'first_account_created', 'first_budget_created', 'first_goal_created')
      AND timestamp > now() - INTERVAL 90 DAY
      AND distinct_id IN (SELECT distinct_id FROM signups)
    GROUP BY distinct_id
  ),
  week_two AS (
    SELECT DISTINCT e.distinct_id AS distinct_id
    FROM events AS e
    INNER JOIN signups AS s ON e.distinct_id = s.distinct_id
    WHERE e.event = 'user_active'
      AND e.timestamp > now() - INTERVAL 90 DAY
      AND e.timestamp >= s.signed_up_at + INTERVAL 7 DAY
      AND e.timestamp < s.signed_up_at + INTERVAL 14 DAY
  )
SELECT
  coalesce(r.platform, 'unknown') AS platform,
  coalesce(s.landing_source, '(none)') AS landing_source,
  count() AS signups,
  countIf(r.has_account) AS first_account,
  countIf(r.has_account AND r.has_plan) AS first_budget_or_goal,
  countIf(s.week_2_eligible) AS week_2_eligible,
  countIf(s.week_2_eligible AND r.has_account AND r.has_plan
    AND s.distinct_id IN (SELECT distinct_id FROM week_two)) AS back_in_week_2
FROM signups AS s
LEFT JOIN reached AS r ON r.distinct_id = s.distinct_id
GROUP BY platform, landing_source
ORDER BY signups DESC
LIMIT 1000
