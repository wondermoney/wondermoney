import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native'

import { BackControl } from '@/components/ui/back-control'
import { Button } from '@/components/ui/button'
import { SafeAreaView } from '@/components/ui/screen-safe-area'
import { Text } from '@/components/ui/text'
import { formatCategoryName } from '@/lib/formatters/category-name'
import { themeTokens } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'

import { Icon, type IconName } from '@/components/ui/icon'

export type Palette = (typeof themeTokens.colors)[keyof typeof themeTokens.colors]

/**
 * One report as an open section of the page — web's `ReportCard`
 * (`components/reports/primitives/ReportCard.tsx`) in the calm structure: no
 * card and no rule, a 20/600 heading, the muted subtitle under it, the header
 * actions (export icon, the report's figure and trend) on their own line at
 * phone width, then the content. Reports are separated by 40pt of space.
 */
export function ReportSection({
  title,
  description,
  actions,
  footer,
  children,
  testID,
}: {
  title: string
  /** Web's `ReportCard` `subtitle`: one muted line saying what the report shows. */
  description: string
  actions?: React.ReactNode
  footer?: React.ReactNode
  children: React.ReactNode
  testID?: string
}) {
  return (
    <View style={styles.section} testID={testID}>
      <View style={styles.sectionHead}>
        <View style={styles.sectionTitle}>
          <Text accessibilityRole="header" variant="heading">{title}</Text>
          <Text tone="muted" variant="meta">{description}</Text>
        </View>
        {actions ? <View style={styles.sectionActions}>{actions}</View> : null}
      </View>
      <View>{children}</View>
      {footer ? <View style={styles.sectionFooter}>{footer}</View> : null}
    </View>
  )
}

/** The loading placeholder inside a section (web `ReportLoadingSkeleton`): muted blocks, no spinner. */
export function ReportSectionLoading({ label }: { label: string; palette?: Palette }) {
  const palette = usePalette()
  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel={label} style={styles.sectionLoading}>
      {[140, 90, 240].map((width, index) => (
        <View key={index} style={[styles.skeleton, { width, maxWidth: '100%', backgroundColor: palette.muted }]} />
      ))}
    </View>
  )
}

/**
 * Web's `ReportEmptyState`: centred, a 40pt muted glyph, a 16/500 title, a
 * 14 muted line, an optional action. No box around it.
 */
export function ReportEmptyState({ icon, title, description, action }: { icon: IconName; title: string; description: string; action?: React.ReactNode }) {
  const palette = usePalette()
  return (
    <View style={styles.state}>
      <Icon color={palette.mutedForeground} name={icon} size={40} />
      <View style={styles.stateText}>
        <Text accessibilityRole="header" align="center" variant="bodyStrong">{title}</Text>
        <Text align="center" tone="muted" variant="meta">{description}</Text>
      </View>
      {action}
    </View>
  )
}

/** Web's `ReportErrorState`: the empty state's shape plus an outline "Retry". */
export function ReportSectionFailure({ invalid = false, onRetry }: { invalid?: boolean; onRetry: () => void | Promise<void>; message?: string; palette?: Palette }) {
  const { t } = useTranslation()
  const palette = usePalette()
  return (
    <View style={styles.state}>
      <Icon color={palette.mutedForeground} name="alert-circle" size={40} />
      <View style={styles.stateText}>
        <Text align="center" variant="bodyStrong">{t(invalid ? 'reports.invalidTitle' : 'reports.errorTitle')}</Text>
        <Text accessibilityRole="alert" align="center" tone="muted" variant="meta">
          {t(invalid ? 'reports.invalidMessage' : 'reports.errorMessage')}
        </Text>
      </View>
      <Button label={t('common.retry')} onPress={onRetry} size="sm" variant="outline" />
    </View>
  )
}

/**
 * A 32pt icon-only ghost control (web `size-8` ghost icon button), muted ink,
 * reaching the 44pt floor through `hitSlop`. The label is for screen readers.
 */
/**
 * `tone="foreground"` is web's ghost Button (foreground ink, lucide stroke 2:
 * the reports reset); the default muted ink is the CSV export's.
 */
export function ReportIconButton({ icon, label, onPress, loading = false, testID, tone = 'muted' }: { icon: IconName; label: string; onPress: () => void | Promise<void>; loading?: boolean; testID?: string; tone?: 'muted' | 'foreground' }) {
  const palette = usePalette()
  const [focused, setFocused] = useState(false)
  const slop = (themeTokens.touchTarget.minimum - 32) / 2
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled: loading, busy: loading }}
      disabled={loading}
      hitSlop={slop}
      onBlur={() => setFocused(false)}
      onFocus={() => setFocused(true)}
      onPress={() => void onPress()}
      style={({ pressed }) => [
        styles.iconButton,
        focused && { borderWidth: 2, borderColor: palette.ring },
        pressed && { backgroundColor: palette.muted },
        loading && styles.inert,
      ]}
      testID={testID}
    >
      {loading ? <ActivityIndicator color={palette.mutedForeground} size="small" /> : <Icon color={tone === 'foreground' ? palette.foreground : palette.mutedForeground} name={icon} weight={tone === 'foreground' ? 'medium' : 'regular'} />}
    </Pressable>
  )
}

/** Web's `ExportCsvButton`: icon-only (`FileDown`), "Export CSV" as its accessible name. */
export function ReportExportButton({ status, onExport }: { status: 'idle' | 'exporting' | 'error'; onExport: () => void | Promise<void>; palette?: Palette }) {
  const { t } = useTranslation()
  return (
    <>
      <ReportIconButton
        icon="file-down"
        label={t(status === 'exporting' ? 'reports.exporting' : 'reports.exportCsv')}
        loading={status === 'exporting'}
        onPress={onExport}
      />
      {status === 'error' ? (
        <Text accessible accessibilityRole="alert" tone="destructive" variant="label" style={styles.exportError}>
          {t('reports.exportError')}
        </Text>
      ) : null}
    </>
  )
}

/**
 * Web's `ReportTrendIndicator`. Two separate questions: the chevron and the
 * sign say which way the figure moved, the colour says whether that is good
 * (`direction`). A flat value is muted with a dash.
 */
export function ReportTrend({ value, percentage, label, direction = 'positive-is-up' }: { value: number; percentage?: number | null; label?: string; direction?: 'positive-is-up' | 'positive-is-down' }) {
  const { t, i18n } = useTranslation()
  const palette = usePalette()
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'
  const flat = value === 0
  const rising = value > 0
  const good = direction === 'positive-is-up' ? value > 0 : value < 0
  const color = flat ? palette.mutedForeground : good ? palette.successText : palette.destructiveText
  const text = label ?? t(flat ? 'reports.trend.flat' : rising ? 'reports.trend.up' : 'reports.trend.down')
  // U+2212, the real minus, so signed figures align in Geist Mono.
  const signed = percentage === undefined || percentage === null
    ? undefined
    : `${flat ? '' : rising ? '+' : '−'}${new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(Math.abs(percentage))}%`
  return (
    <View accessible accessibilityLabel={`${text} ${signed ?? ''}`.trim()} style={styles.trend}>
      <Icon color={color} name={flat ? 'minus' : rising ? 'chevron-up' : 'chevron-down'} />
      <Text variant="metaStrong" style={{ color }}>{text}</Text>
      {signed !== undefined ? <Text variant="amount" style={{ color }}>{signed}</Text> : null}
    </View>
  )
}

export type ReportTableColumn = Readonly<{ key: string; label: string; align?: 'left' | 'right'; width?: number }>
export type ReportTableRow = Readonly<{
  key: string
  accessibilityLabel: string
  cells: Readonly<Record<string, React.ReactNode>>
  /** `over` is web's `bg-destructive/5` over-budget row; `total` its `font-medium` total row. */
  emphasis?: 'over' | 'total'
}>

/**
 * Web's `SimpleTable` at phone width: a muted header row (14/500 muted), rows
 * split by a hairline, `px-3 py-2` cells, no outer border. With `scrollable`,
 * the columns take fixed widths and the table scrolls sideways, as web's
 * `overflow-x-auto` wrapper does for the five- and six-column reports.
 */
export function ReportTable({ columns, rows, scrollable = false, testID }: { columns: readonly ReportTableColumn[]; rows: readonly ReportTableRow[]; scrollable?: boolean; testID?: string }) {
  const palette = usePalette()
  const cellStyle = (column: ReportTableColumn) => [
    styles.cell,
    scrollable ? { width: column.width ?? 128 } : styles.flexCell,
    column.align === 'right' && styles.right,
  ]
  const table = (
    <View style={scrollable ? null : styles.fill} testID={testID}>
      <View style={[styles.row, { backgroundColor: palette.muted }]}>
        {columns.map((column) => (
          <View key={column.key} style={cellStyle(column)}>
            <Text align={column.align ?? 'left'} tone="muted" variant="metaStrong">{column.label}</Text>
          </View>
        ))}
      </View>
      {rows.map((row) => (
        <View
          key={row.key}
          accessible
          accessibilityLabel={row.accessibilityLabel}
          style={[
            styles.row,
            { borderTopWidth: 1, borderTopColor: palette.border },
            row.emphasis === 'over' && { backgroundColor: `${palette.destructive}0D` },
          ]}
        >
          {columns.map((column) => {
            const cell = row.cells[column.key]
            return (
              <View key={column.key} style={cellStyle(column)}>
                {typeof cell === 'string' ? (
                  <Text align={column.align ?? 'left'} variant={row.emphasis === 'total' ? 'metaStrong' : 'meta'}>{cell}</Text>
                ) : cell}
              </View>
            )
          })}
        </View>
      ))}
    </View>
  )
  if (!scrollable) return table
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      {table}
    </ScrollView>
  )
}

/**
 * Category names as web shows them: the reports endpoints send a system
 * category as its raw key (`CAFE_RESTAURANTS_BARS`), which web translates with
 * the category picker's names ("Cafe, Restaurants & Bars"). Anything else —
 * a person's own category, an account — keeps its name.
 */
export function useReportCategoryName() {
  const { t } = useTranslation()
  return useCallback((name: string) => {
    if (!/^[A-Z0-9_&\s]+$/.test(name) || !/[A-Z]/.test(name)) return name
    const key = name.trim().toLowerCase().replace(/[_\s&]+/g, '-').replace(/[^a-z0-9-]/g, '')
    return t(`categories.system.${key}`, { defaultValue: formatCategoryName(name) })
  }, [t])
}

/**
 * A standalone report route (`/reports/<slug>`, kept for deep links): the
 * "← Reports" link, then exactly what the hub shows for that report — the one
 * filter row and the open section.
 */
export function ReportStandalonePage({ onBack, refreshing, onRefresh, controls, children }: { onBack: () => void; refreshing: boolean; onRefresh: () => void | Promise<void>; controls: React.ReactNode; children: React.ReactNode }) {
  const { t } = useTranslation()
  const palette = usePalette()
  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.background }]}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={palette.primary} />}
      >
        <View style={styles.page}>
          <BackControl destination={t('navigation.reports')} fallback="/reports" onPress={onBack} />
          <View style={styles.reports}>
            {controls}
            {children}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

export const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: { flexGrow: 1, padding: themeTokens.layout.screenPadding, paddingBottom: themeTokens.spacing[12] },
  page: { width: '100%', maxWidth: 760, alignSelf: 'center', gap: themeTokens.spacing[8] },
  /** Space, not rules, between the filter row and the reports: 40pt and a 20/600 heading. */
  reports: { gap: themeTokens.spacing[10] },
  section: { gap: themeTokens.spacing[4] },
  sectionHead: { gap: themeTokens.spacing[4] },
  sectionTitle: { gap: themeTokens.spacing[1] },
  sectionActions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: themeTokens.spacing[2] },
  sectionFooter: { paddingTop: themeTokens.spacing[4] },
  sectionLoading: { width: '100%', gap: themeTokens.spacing[3] },
  skeleton: { height: 72, borderRadius: themeTokens.radius.lg },
  state: { alignItems: 'center', justifyContent: 'center', gap: themeTokens.spacing[3], paddingHorizontal: themeTokens.spacing[6], paddingVertical: themeTokens.spacing[10] },
  stateText: { maxWidth: 320, gap: themeTokens.spacing[1], alignItems: 'center' },
  iconButton: { width: 32, height: 32, borderRadius: themeTokens.radius.md, alignItems: 'center', justifyContent: 'center' },
  inert: { opacity: 0.5 },
  exportError: { flexBasis: '100%' },
  trend: { flexDirection: 'row', alignItems: 'center', gap: themeTokens.spacing[1] },
  fill: { width: '100%' },
  row: { flexDirection: 'row', alignItems: 'center' },
  cell: { paddingHorizontal: themeTokens.spacing[3], paddingVertical: themeTokens.spacing[2] },
  flexCell: { flex: 1 },
  right: { alignItems: 'flex-end' },
})
