-- Enable Banking key setup: per week over the last 12 weeks, the wizard openings and the steps
-- they reached, the people who created a certificate and how many of them activated it or let
-- it lapse, and why activations failed.
-- `started` and the `reached_*` steps come from the apps, only with the person's analytics
-- opt-in, and are not tied to an account: they count openings, for their trend. The rest come
-- from the server for everyone, keyed by the person: each person counts once, in the week of
-- their first certificate in the window, as activated if they activated a key afterwards, and
-- as abandoned if a key lapsed and they never activated one. The failure columns count attempts,
-- in the week they were made.
WITH
  weeks AS (
    SELECT DISTINCT toStartOfWeek(timestamp, 1) AS week
    FROM events
    WHERE event IN ('bank_key_setup_started', 'bank_key_setup_step_viewed', 'bank_key_certificate_created',
        'bank_key_activation_failed', 'bank_key_activated', 'bank_key_setup_abandoned')
      AND timestamp >= toStartOfWeek(now() - INTERVAL 12 WEEK, 1)
  ),
  wizard AS (
    SELECT
      toStartOfWeek(timestamp, 1) AS week,
      countIf(event = 'bank_key_setup_started') AS started,
      countIf(event = 'bank_key_setup_step_viewed' AND properties.step = 'create_application') AS reached_create_application,
      countIf(event = 'bank_key_setup_step_viewed' AND properties.step = 'activate') AS reached_activate,
      countIf(event = 'bank_key_setup_step_viewed' AND properties.step = 'application_id') AS reached_application_id,
      countIf(event = 'bank_key_setup_step_viewed' AND properties.step = 'done') AS reached_done
    FROM events
    WHERE event IN ('bank_key_setup_started', 'bank_key_setup_step_viewed')
      AND timestamp >= toStartOfWeek(now() - INTERVAL 12 WEEK, 1)
    GROUP BY week
  ),
  certificates AS (
    SELECT distinct_id, min(timestamp) AS first_certificate_at
    FROM events
    WHERE event = 'bank_key_certificate_created'
      AND timestamp >= toStartOfWeek(now() - INTERVAL 12 WEEK, 1)
    GROUP BY distinct_id
  ),
  outcomes AS (
    SELECT
      certificates.distinct_id AS distinct_id,
      countIf(events.event = 'bank_key_activated') > 0 AS activated,
      countIf(events.event = 'bank_key_activation_failed') > 0 AS failed,
      countIf(events.event = 'bank_key_setup_abandoned') > 0 AS abandoned
    FROM certificates
    INNER JOIN events ON events.distinct_id = certificates.distinct_id
    WHERE events.event IN ('bank_key_activated', 'bank_key_activation_failed', 'bank_key_setup_abandoned')
      AND events.timestamp >= certificates.first_certificate_at
    GROUP BY distinct_id
  ),
  people AS (
    SELECT
      toStartOfWeek(certificates.first_certificate_at, 1) AS week,
      count() AS certificate_created,
      countIf(outcomes.activated) AS activated,
      countIf(outcomes.failed) AS failed_at_least_once,
      countIf(outcomes.abandoned AND NOT outcomes.activated) AS abandoned
    FROM certificates
    LEFT JOIN outcomes ON outcomes.distinct_id = certificates.distinct_id
    GROUP BY week
  ),
  failures AS (
    SELECT
      toStartOfWeek(timestamp, 1) AS week,
      count() AS activation_failures,
      countIf(properties.reason = 'application_not_found') AS application_not_found,
      countIf(properties.reason = 'application_sandbox') AS application_sandbox,
      countIf(properties.reason = 'application_not_activated') AS application_not_activated,
      countIf(properties.reason = 'credential_refused') AS credential_refused,
      countIf(properties.reason = 'pending_credential_missing') AS pending_credential_missing,
      countIf(properties.reason IN ('rate_limited', 'provider_unavailable')) AS provider_unavailable,
      countIf(properties.reason = 'unknown') AS unknown
    FROM events
    WHERE event = 'bank_key_activation_failed'
      AND timestamp >= toStartOfWeek(now() - INTERVAL 12 WEEK, 1)
    GROUP BY week
  )
SELECT
  weeks.week AS week,
  coalesce(wizard.started, 0) AS started,
  coalesce(wizard.reached_create_application, 0) AS reached_create_application,
  coalesce(wizard.reached_activate, 0) AS reached_activate,
  coalesce(wizard.reached_application_id, 0) AS reached_application_id,
  coalesce(wizard.reached_done, 0) AS reached_done,
  coalesce(people.certificate_created, 0) AS certificate_created,
  coalesce(people.activated, 0) AS activated,
  coalesce(people.failed_at_least_once, 0) AS failed_at_least_once,
  coalesce(people.abandoned, 0) AS abandoned,
  coalesce(failures.activation_failures, 0) AS activation_failures,
  coalesce(failures.application_not_found, 0) AS application_not_found,
  coalesce(failures.application_sandbox, 0) AS application_sandbox,
  coalesce(failures.application_not_activated, 0) AS application_not_activated,
  coalesce(failures.credential_refused, 0) AS credential_refused,
  coalesce(failures.pending_credential_missing, 0) AS pending_credential_missing,
  coalesce(failures.provider_unavailable, 0) AS provider_unavailable,
  coalesce(failures.unknown, 0) AS unknown
FROM weeks
LEFT JOIN wizard ON wizard.week = weeks.week
LEFT JOIN people ON people.week = weeks.week
LEFT JOIN failures ON failures.week = weeks.week
ORDER BY week
LIMIT 1000
