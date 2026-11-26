-- Signups by referrer class: per kind of source a visit came to the website from (an AI
-- assistant, search, social, direct or other), the visits to the site, and the signups and
-- activations they led to, over the last 90 days.
-- How the class gets from the site to the `signup` event: docs/landing-attribution.md.
WITH
  site AS (
    SELECT
      properties.referrer_class AS referrer_class,
      countIf(properties.$referring_domain NOT IN ('wonder.money', 'www.wonder.money')) AS entrances
    FROM events
    WHERE timestamp > now() - INTERVAL 90 DAY
      AND event = '$pageview'
      AND isNotNull(properties.referrer_class)
    GROUP BY referrer_class
  ),
  signups AS (
    SELECT distinct_id, properties.referrer_class AS referrer_class
    FROM events
    WHERE event = 'signup'
      AND timestamp > now() - INTERVAL 90 DAY
      AND isNotNull(properties.referrer_class)
  ),
  app AS (
    SELECT
      referrer_class,
      count() AS signups,
      countIf(distinct_id IN (
        SELECT distinct_id FROM events
        WHERE event IN ('first_budget_created', 'first_goal_created')
      )) AS activations
    FROM signups
    GROUP BY referrer_class
  )
SELECT
  site.referrer_class AS referrer_class,
  site.entrances AS entrances,
  coalesce(app.signups, 0) AS signups,
  coalesce(app.activations, 0) AS activations
FROM site
LEFT JOIN app ON app.referrer_class = site.referrer_class
ORDER BY entrances DESC
LIMIT 1000
