import { useTranslation } from 'react-i18next'
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'

import { Icon } from '@/components/ui/icon'
import { Text } from '@/components/ui/text'
import { formatRelativeTime, type RelativeTimeStyle } from '@/lib/formatters/relative-time'
import { usePalette } from '@/theme/use-palette'

export type DataProvenanceProps = {
  /** When the data was last refreshed at source. Nothing renders without a valid time. */
  updatedAt?: Date | string | null
  /** Wraps the relative time ("Balances updated {time}"). Without it, the bare "1 day ago". */
  label?: (relativeTime: string) => string
  /** Amber and medium weight, as web marks a stale sync. */
  isStale?: boolean
  /** A broken connection: destructive, with its own message, instead of the time. */
  errorLabel?: string
  /** Web's refresh glyph before the time. Off for web's plain AccountsFreshness line (home, transactions). */
  icon?: boolean
  /** `distance` ("about 5 hours ago", web DataProvenance) or `calendar` ("yesterday", web recurring). */
  timeStyle?: RelativeTimeStyle
  /** Test clock. */
  now?: number
  style?: StyleProp<ViewStyle>
  testID?: string
}

/**
 * Web's `DataProvenance` (`components/ui/DataProvenance.tsx`): when this data is
 * from, in muted 12px — "Balances updated 1 day ago". Every freshness line in
 * the app goes through it so they all read alike.
 */
export function DataProvenance({
  updatedAt,
  label,
  isStale = false,
  errorLabel,
  icon = true,
  timeStyle = 'distance',
  now,
  style,
  testID,
}: DataProvenanceProps) {
  const { t } = useTranslation()
  const palette = usePalette()
  if (errorLabel) {
    return (
      <View style={[styles.row, style]} testID={testID}>
        {icon ? <Icon color={palette.destructiveText} name="alert-circle" size={12} /> : null}
        <Text style={styles.strong} tone="destructive" variant="label">{errorLabel}</Text>
      </View>
    )
  }
  const relative = formatRelativeTime(updatedAt, t, { now, style: timeStyle })
  if (!relative) return null
  return (
    <View style={[styles.row, style]} testID={testID}>
      {icon ? <Icon color={isStale ? palette.warningText : palette.mutedForeground} name="refresh-cw" size={12} /> : null}
      <Text style={isStale ? styles.strong : null} tone={isStale ? 'warning' : 'muted'} variant="label">
        {label ? label(relative) : relative}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  // Web `inline-flex items-center gap-1.5`.
  row: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  strong: { fontWeight: '500' },
})
