import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'

import { DataProvenance } from '@/components/ui/data-provenance'
import { formatRelativeTime } from '@/lib/formatters/relative-time'

import type { Freshness } from './account-freshness'

/**
 * Web's accounts `DataProvenance`: "Balances updated 1 day ago" with the
 * refresh glyph, amber when a connection is stale, destructive with its own
 * message when one is broken. Nothing without a sync time.
 */
export function BalancesProvenance({ freshness, testID }: { freshness: Freshness | null; testID?: string }) {
  const { t } = useTranslation()
  if (!freshness) return null
  return (
    <DataProvenance
      errorLabel={freshness.hasError ? t('accountsOverview.balancesStale') : undefined}
      isStale={freshness.isStale}
      label={(time) => t('accountsOverview.balancesUpdated', { time })}
      style={{ marginTop: 4 }}
      testID={testID}
      updatedAt={freshness.updatedAt}
    />
  )
}

/**
 * The same freshness as a `HeadlineFigure` status line: "Balances updated 1
 * day ago" behind a muted dot, amber when a connection is stale, destructive
 * (with its own words) when one is broken. `undefined` without a sync time.
 */
export function freshnessStatus(
  freshness: Freshness | null,
  t: TFunction,
): { label: string; tone: 'muted' | 'warning' | 'destructive' } | undefined {
  if (!freshness) return undefined
  if (freshness.hasError) return { label: t('accountsOverview.balancesStale'), tone: 'destructive' }
  const time = formatRelativeTime(freshness.updatedAt, t)
  if (!time) return undefined
  return { label: t('accountsOverview.balancesUpdated', { time }), tone: freshness.isStale ? 'warning' : 'muted' }
}
