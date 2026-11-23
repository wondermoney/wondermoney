-- Landing attribution: per website tool or resource list, the visits, uses and next-step
-- clicks on the site, and the signups and activations they led to, over the last 90 days.
-- How the route id gets from the site to the `signup` event: docs/landing-attribution.md.
WITH
  site AS (
    SELECT
      properties.landing_source AS source,
      countIf(event = '$pageview'
        AND properties.$referring_domain NOT IN ('wonder.money', 'www.wonder.money')) AS entrances,
      countIf(event IN ('tool_used', 'curated_list_entry_click')) AS completions,
      countIf(event = 'cta_click'
        AND properties.cta_position IN ('cta_banner', 'tool_result')) AS next_step_clicks
    FROM events
    WHERE timestamp > now() - INTERVAL 90 DAY
      AND event IN ('$pageview', 'tool_used', 'curated_list_entry_click', 'cta_click')
      AND isNotNull(properties.landing_source)
    GROUP BY source
  ),
  signups AS (
    SELECT distinct_id, properties.landing_source AS source
    FROM events
    WHERE event = 'signup'
      AND timestamp > now() - INTERVAL 90 DAY
      AND isNotNull(properties.landing_source)
  ),
  app AS (
    SELECT
      source,
      count() AS signups,
      countIf(distinct_id IN (
        SELECT distinct_id FROM events
        WHERE event IN ('first_budget_created', 'first_goal_created')
      )) AS activations
    FROM signups
    GROUP BY source
  )
SELECT
  site.source AS source,
  site.entrances AS entrances,
  site.completions AS completions,
  site.next_step_clicks AS next_step_clicks,
  coalesce(app.signups, 0) AS signups,
  coalesce(app.activations, 0) AS activations
FROM site
LEFT JOIN app ON app.source = site.source
ORDER BY entrances DESC
LIMIT 1000
