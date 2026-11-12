import { useTranslation } from 'react-i18next'

import { Badge, type BadgeTone } from '@/components/ui/badge'

import type { InstallmentStatus } from './installments-contract'

/** A calendar day from the API (`YYYY-MM-DD`) in `locale`; noon UTC keeps it on its own day everywhere. */
export function formatPlanDay(value: string, locale: string, options: Intl.DateTimeFormatOptions = { dateStyle: 'medium' }): string {
  const date = new Date(`${value.slice(0, 10)}T12:00:00.000Z`)
  if (!Number.isFinite(date.getTime())) return value
  try {
    return new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' }).format(date)
  } catch {
    return value.slice(0, 10)
  }
}

const STATUS_TONES: Record<InstallmentStatus, BadgeTone> = {
  paid: 'success',
  // A projection: neutral, like the forecast's expected payments.
  upcoming: 'outline',
  unmatched: 'warning',
}

/** Paid / Upcoming / Not matched, as a word in a badge. Nothing for a status this build does not know. */
export function InstallmentStatusBadge({ status, testID }: { status: InstallmentStatus | null; testID?: string }) {
  const { t } = useTranslation()
  if (!status) return null
  return <Badge label={t(`installments.status.${status}`)} testID={testID} tone={STATUS_TONES[status]} />
}
