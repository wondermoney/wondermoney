import { useTranslation } from 'react-i18next'
import { ScrollView, StyleSheet, Switch, View } from 'react-native'

import { BackControl } from '@/components/ui/back-control'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { PageHeader } from '@/components/ui/page-header'
import { SafeAreaView } from '@/components/ui/screen-safe-area'
import { Text } from '@/components/ui/text'
import { SettingsNotice } from '@/features/more/settings-ui'
import { themeTokens } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'

import type { DashboardLayoutEntry, DashboardSectionMove } from '@wondermoney/shared/dashboard-layout'

export type CustomizeHomeScreenProps = {
  /** The merged layout: every section this build renders, in the saved order. */
  layout: readonly DashboardLayoutEntry[]
  isLoading?: boolean
  isLoadError?: boolean
  isSaving?: boolean
  saveError?: boolean
  onMove: (id: string, direction: DashboardSectionMove) => void
  /** `visible` is the switch's new state; the stored flag is its inverse. */
  onToggle: (id: string, visible: boolean) => void
  onReset: () => void
  onRetryLoad: () => void
  onRetrySave: () => void
  onBack: () => void
}

/**
 * Home › Customize home: one row per section with up and down buttons and a
 * visibility switch, plus "Reset to default". Net worth is listed but its
 * controls are disabled — it is the figure the page exists for.
 *
 * The same list as web's "Customize" sheet, on its own screen because a phone
 * has no room for a side sheet over the home. Every change is saved as the
 * whole layout, so the arrangement follows the person to the other client.
 */
export function CustomizeHomeScreen({
  layout,
  isLoading = false,
  isLoadError = false,
  isSaving = false,
  saveError = false,
  onMove,
  onToggle,
  onReset,
  onRetryLoad,
  onRetrySave,
  onBack,
}: CustomizeHomeScreenProps) {
  const { t } = useTranslation()
  const palette = usePalette()
  const sectionName = (id: string) => t(`home.customize.sections.${id}`)

  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} style={[styles.safeArea, { backgroundColor: palette.background }]}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.page}>
          <View style={styles.head}>
            <BackControl destination={t('navigation.home')} fallback="/" label={t('home.customize.back')} onPress={onBack} />
            <PageHeader description={t('home.customize.description')} title={t('home.customize.title')} />
          </View>

          {isLoading ? (
            <View accessibilityLabel={t('home.customize.loading')} accessibilityRole="progressbar" style={styles.skeletonList}>
              {Array.from({ length: 6 }, (_, index) => (
                <View key={index} style={[styles.skeleton, { backgroundColor: palette.muted }]} />
              ))}
            </View>
          ) : isLoadError ? (
            <SettingsNotice
              action={<Button label={t('home.customize.retry')} onPress={onRetryLoad} size="sm" variant="secondary" />}
              alert
              message={t('home.customize.loadError')}
              tone="destructive"
            />
          ) : (
            <View style={[styles.list, { borderColor: palette.border }]}>
              {layout.map((entry, index) => {
                const pinned = entry.id === 'net-worth'
                const name = sectionName(entry.id)
                const canMoveUp = !pinned && index > 1
                const canMoveDown = !pinned && index < layout.length - 1

                return (
                  <View
                    key={entry.id}
                    style={[styles.row, index > 0 && { borderTopWidth: 1, borderTopColor: palette.border }]}
                    testID={`customize-row-${entry.id}`}
                  >
                    <View style={styles.rowLabel}>
                      <Text variant="body">{name}</Text>
                      {pinned ? (
                        <Text tone="muted" variant="label">{t('home.customize.pinned')}</Text>
                      ) : null}
                    </View>

                    <View style={styles.rowControls}>
                      <IconButton
                        accessibilityLabel={t('home.customize.moveUp', { section: name })}
                        disabled={!canMoveUp || isSaving}
                        icon="chevron-up"
                        onPress={() => onMove(entry.id, 'up')}
                        testID={`customize-up-${entry.id}`}
                      />
                      <IconButton
                        accessibilityLabel={t('home.customize.moveDown', { section: name })}
                        disabled={!canMoveDown || isSaving}
                        icon="chevron-down"
                        onPress={() => onMove(entry.id, 'down')}
                        testID={`customize-down-${entry.id}`}
                      />
                      <Switch
                        accessibilityLabel={name}
                        disabled={pinned || isSaving}
                        hitSlop={{ top: 10, bottom: 10 }}
                        onValueChange={(visible) => onToggle(entry.id, visible)}
                        testID={`customize-visible-${entry.id}`}
                        value={!entry.hidden}
                      />
                    </View>
                  </View>
                )
              })}
            </View>
          )}

          <View style={styles.footer}>
            {isSaving ? <Text accessibilityRole="alert" tone="muted" variant="label">{t('home.customize.saving')}</Text> : null}
            {saveError ? (
              <SettingsNotice
                action={<Button label={t('home.customize.retry')} onPress={onRetrySave} size="sm" variant="secondary" />}
                alert
                message={t('home.customize.saveError')}
                tone="destructive"
              />
            ) : null}
            <Button
              disabled={isLoading || isLoadError || isSaving}
              label={t('home.customize.reset')}
              onPress={onReset}
              variant="secondary"
            />
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: { flexGrow: 1, padding: themeTokens.layout.screenPadding, paddingBottom: themeTokens.spacing[12] },
  page: { width: '100%', maxWidth: 760, alignSelf: 'center', gap: themeTokens.spacing[8] },
  head: { gap: themeTokens.spacing[4] },
  list: { borderWidth: 1, borderRadius: themeTokens.radius.lg },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: themeTokens.spacing[3],
    minHeight: themeTokens.touchTarget.minimum,
    paddingLeft: themeTokens.spacing[4],
    paddingRight: themeTokens.spacing[2],
    paddingVertical: themeTokens.spacing[2],
  },
  rowLabel: { flex: 1, minWidth: 0, gap: themeTokens.spacing[1] },
  rowControls: { flexDirection: 'row', alignItems: 'center', gap: themeTokens.spacing[1] },
  footer: { gap: themeTokens.spacing[4], alignItems: 'stretch' },
  skeletonList: { gap: themeTokens.spacing[3] },
  skeleton: { height: 44, borderRadius: themeTokens.radius.md },
})
