import { useTranslation } from 'react-i18next'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { Button } from '@/components/ui/button'
import { themeTokens } from '@/theme/tokens'
import { textStyles } from '@/theme/typography'

import { REPORT_DATE_PRESETS, type ReportDatePreset } from './report-date-presets'

export type Palette = (typeof themeTokens.colors)[keyof typeof themeTokens.colors]

/**
 * A single report's title + helper, used both by the standalone screen's
 * ReportHeader (with a back control) and by a section composed inline on
 * the reports hub (no back control — there's one for the whole hub page).
 */
export function ReportSectionHeading({ title, helper, palette }: { title: string; helper: string; palette: Palette }) {
  return (
    <View style={styles.sectionHeading}>
      <Text accessibilityRole="header" allowFontScaling style={[styles.sectionHeadingTitle, { color: palette.foreground }]}>{title}</Text>
      <Text allowFontScaling style={[styles.sectionHeadingHelper, { color: palette.mutedForeground }]}>{helper}</Text>
    </View>
  )
}

/** Loading/failure states sized to sit inside a composed section rather than
 * fill the screen — no SafeAreaView, no centering, no Back control. */
export function ReportSectionLoading({ label, palette }: { label: string; palette: Palette }) {
  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel={label} style={styles.sectionLoading}>
      {[140, 90, 240].map((width, index) => (
        <View key={index} style={[styles.skeleton, { width, maxWidth: '100%', backgroundColor: palette.muted }]} />
      ))}
    </View>
  )
}

/** No title — the section's own ReportSectionHeading already carries it. */
export function ReportSectionFailure({ message, onRetry, palette }: { message: string; onRetry: () => void | Promise<void>; palette: Palette }) {
  const { t } = useTranslation()
  return (
    <View style={styles.sectionFailure}>
      <Text accessibilityRole="alert" allowFontScaling style={[styles.body, { color: palette.mutedForeground }]}>{message}</Text>
      <Button label={t('common.retry')} onPress={onRetry} palette={palette} variant="secondary" />
    </View>
  )
}

export function ReportPresetBar({ preset, onSelectPreset, palette }: { preset: ReportDatePreset; onSelectPreset: (preset: ReportDatePreset) => void; palette: Palette }) {
  const { t } = useTranslation()
  return (
    <View accessibilityRole="tablist" style={styles.presets}>
      {REPORT_DATE_PRESETS.map((value) => (
        <ReportPresetButton
          key={value}
          label={t(`reports.datePresets.${value}`)}
          selected={value === preset}
          onPress={() => onSelectPreset(value)}
          palette={palette}
        />
      ))}
    </View>
  )
}

export function ReportExportButton({ status, onExport, palette }: { status: 'idle' | 'exporting' | 'error'; onExport: () => void | Promise<void>; palette: Palette }) {
  const { t } = useTranslation()
  const label = t(status === 'exporting' ? 'reports.exporting' : 'reports.exportCsv')
  return (
    <View style={styles.exportRow}>
      <Button
        disabled={status === 'exporting'}
        label={label}
        onPress={onExport}
        palette={palette}
        variant="secondary"
      />
      {status === 'error' ? (
        <Text accessible accessibilityRole="alert" allowFontScaling style={[styles.exportError, { color: palette.destructive }]}>
          {t('reports.exportError')}
        </Text>
      ) : null}
    </View>
  )
}

function ReportPresetButton({ label, selected, onPress, palette }: { label: string; selected: boolean; onPress: () => void; palette: Palette }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      hitSlop={{ top: 7, bottom: 7 }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.preset,
        // Unselected presets carry no border — six date-range chips wrapping
        // to two rows each individually boxed read as a wall of empty
        // containers, not one date-range picker. Only the active preset
        // earns a border/fill.
        selected ? { borderColor: palette.primary, backgroundColor: palette.primaryWash } : { borderWidth: 0, backgroundColor: palette.muted },
        pressed && styles.pressed,
      ]}
    >
      <Text allowFontScaling style={[styles.presetText, { color: selected ? palette.primary : palette.mutedForeground }]}>{label}</Text>
    </Pressable>
  )
}

export const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: { flexGrow: 1, padding: themeTokens.layout.screenPadding },
  page: { width: '100%', maxWidth: 760, alignSelf: 'center', gap: themeTokens.layout.blockGap },
  header: { gap: themeTokens.spacing[4] },
  back: { minHeight: themeTokens.touchTarget.minimum, alignSelf: 'flex-start', justifyContent: 'center' },
  backText: { ...textStyles.action },
  presets: { flexDirection: 'row', flexWrap: 'wrap', gap: themeTokens.spacing[2] },
  preset: { minHeight: 34, borderWidth: 1, borderRadius: themeTokens.radius.md, alignItems: 'center', justifyContent: 'center', paddingHorizontal: themeTokens.spacing[3] },
  presetText: { ...textStyles.meta },
  empty: { borderWidth: 1, borderRadius: themeTokens.radius.xl, padding: themeTokens.layout.screenPadding, gap: themeTokens.spacing[3] },
  emptyTitle: { ...textStyles.section },
  body: { ...textStyles.body },
  loading: { flex: 1, width: '100%', maxWidth: 760, alignSelf: 'center', padding: themeTokens.layout.screenPadding, gap: themeTokens.spacing[5] },
  skeleton: { height: 72, borderRadius: themeTokens.radius.lg },
  failure: { flex: 1, width: '100%', maxWidth: 520, alignSelf: 'center', justifyContent: 'center', padding: themeTokens.layout.screenPadding, gap: themeTokens.spacing[4] },
  failureTitle: { ...textStyles.title },
  failureActions: { flexDirection: 'row', flexWrap: 'wrap', gap: themeTokens.spacing[3] },
  pressed: { opacity: 0.68 },
  exportRow: { alignSelf: 'flex-start', gap: themeTokens.spacing[2] },
  exportError: { ...textStyles.meta },
  section: { width: '100%', gap: themeTokens.layout.blockGap },
  sectionHeading: { gap: themeTokens.spacing[1] },
  sectionHeadingTitle: { ...textStyles.title },
  sectionHeadingHelper: { ...textStyles.body },
  sectionLoading: { width: '100%', gap: themeTokens.spacing[3] },
  sectionFailure: { width: '100%', alignItems: 'flex-start', gap: themeTokens.spacing[3] },
})
