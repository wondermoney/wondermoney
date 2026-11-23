-- Imports: each step per kind and format, over the last 12 weeks. Started, mapped, reviewed and
-- failed come from the apps, only with the person's analytics opt-in; `committed` comes from the
-- server for everyone, so it can exceed `reviewed`. A mobile bank statement CSV goes from
-- `started` straight to `committed`. A step's format is `unknown` until the file is read.
SELECT
  properties.kind AS kind,
  coalesce(properties.format, 'unknown') AS format,
  countIf(event = 'import_started') AS started,
  countIf(event = 'import_mapped') AS mapped,
  countIf(event = 'import_reviewed') AS reviewed,
  countIf(event = 'import_committed') AS committed,
  countIf(event = 'import_failed' AND properties.step = 'upload') AS failed_upload,
  countIf(event = 'import_failed' AND properties.step = 'read') AS failed_read,
  countIf(event = 'import_failed' AND properties.step = 'mapping') AS failed_mapping,
  countIf(event = 'import_failed' AND properties.step = 'review') AS failed_review,
  countIf(event = 'import_failed' AND properties.step = 'commit') AS failed_commit
FROM events
WHERE event IN ('import_started', 'import_mapped', 'import_reviewed', 'import_committed', 'import_failed')
  AND timestamp >= toStartOfWeek(now() - INTERVAL 12 WEEK, 1)
GROUP BY kind, format
ORDER BY started DESC, committed DESC
LIMIT 1000
