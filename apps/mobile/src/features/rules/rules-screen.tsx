import { type ReactNode, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Alert, RefreshControl, StyleSheet, Switch, View } from 'react-native'

import { Button } from '@/components/ui/button'
import { ListRow } from '@/components/ui/list-row'
import { OptionSheet } from '@/components/ui/sheet'
import { Text } from '@/components/ui/text'
import { SettingsGroup, SettingsLoading, SettingsNotice, SettingsPage, SettingsSection } from '@/features/more/settings-ui'
import { themeTokens } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'

import type { RuleListItem } from './rules-view-model'

export type RulesViewState =
  | { status: 'loading' | 'error' | 'invalid-response' | 'access-transition' }
  | { status: 'loaded' | 'refresh-error'; rules: readonly RuleListItem[]; refreshing?: boolean }

/**
 * Settings › Rules (web `components/settings/Rules.tsx`): the household's rules in run order,
 * each with its one-line summary and an active switch. Reordering stays on web; a rule that uses
 * a field the app cannot show opens read-only instead of an editor.
 */
export function RulesScreen({
  state,
  writeBlocked = false,
  demoLocked = false,
  pending = false,
  onBack,
  onRetry,
  onOpenRule,
  onToggleActive,
  onDelete,
  offer,
}: {
  state: RulesViewState
  writeBlocked?: boolean
  demoLocked?: boolean
  pending?: boolean
  onBack: () => void
  onRetry: () => void | Promise<void>
  onOpenRule: (rule: RuleListItem) => void
  onToggleActive: (ruleId: number, active: boolean) => void
  onDelete: (ruleId: number) => void
  /** Shown above the list once it has loaded: the locale rule preset offer. */
  offer?: ReactNode
}) {
  const { t } = useTranslation()
  const palette = usePalette()
  const [menuRuleId, setMenuRuleId] = useState<number | null>(null)
  if (state.status === 'access-transition') return null
  const loaded = state.status === 'loaded' || state.status === 'refresh-error'
  const menuRule = menuRuleId === null ? null : state.status === 'loaded' || state.status === 'refresh-error'
    ? state.rules.find((rule) => rule.id === menuRuleId) ?? null
    : null

  const confirmDelete = (rule: RuleListItem) => {
    Alert.alert(t('rules.deleteTitle', { name: rule.name }), t('rules.deleteMessage'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('rules.delete'), style: 'destructive', onPress: () => onDelete(rule.id) },
    ])
  }

  const openRule = (rule: RuleListItem) => {
    if (rule.editable) onOpenRule(rule)
    else Alert.alert(t('rules.readOnlyTitle'), t('rules.readOnlyMessage'))
  }

  return (
    <SettingsPage
      backLabel={t('rules.back')}
      onBack={onBack}
      refreshControl={loaded ? <RefreshControl refreshing={Boolean(state.refreshing)} onRefresh={onRetry} tintColor={palette.primary} /> : undefined}
      section="rules"
    >
      <SettingsSection first title={t('rules.title')} description={t('rules.description')}>
        {writeBlocked ? <Text accessibilityRole="alert" tone="muted" variant="meta">{t(demoLocked ? 'rules.demoWriteBlocked' : 'rules.writeBlocked')}</Text> : null}
        {state.status === 'loading' ? <SettingsLoading label={t('rules.loading')} /> : null}
        {state.status === 'error' || state.status === 'invalid-response' ? (
          <SettingsNotice
            action={<Button label={t('common.retry')} onPress={() => void onRetry()} size="sm" variant="outline" />}
            alert
            message={t(state.status === 'invalid-response' ? 'rules.invalidMessage' : 'rules.errorMessage')}
            title={t(state.status === 'invalid-response' ? 'rules.invalidTitle' : 'rules.errorTitle')}
          />
        ) : null}
        {loaded ? <>
          {offer}
          {state.status === 'refresh-error' ? (
            <SettingsNotice
              action={<Button label={t('common.retry')} onPress={() => void onRetry()} size="sm" variant="outline" />}
              alert
              message={t('rules.stale')}
            />
          ) : null}
          {state.rules.length === 0
            ? <Text tone="muted" variant="meta">{t('rules.empty')}</Text>
            : (
              <SettingsGroup>
                {state.rules.map((rule, index) => (
                  <View key={rule.id} style={styles.row}>
                    <ListRow
                      accessibilityLabel={[rule.name, rule.summary, rule.active ? null : t('rules.inactive'), rule.stopProcessing ? t('rules.stops') : null, rule.editable ? null : t('rules.readOnly')].filter(Boolean).join(', ')}
                      density="comfortable"
                      figure={(
                        <Switch
                          accessibilityLabel={t('rules.toggleNamed', { name: rule.name })}
                          accessibilityRole="switch"
                          accessibilityState={{ checked: rule.active, disabled: writeBlocked || pending }}
                          disabled={writeBlocked || pending}
                          onValueChange={(next) => onToggleActive(rule.id, next)}
                          testID={`rule-active-${rule.id}`}
                          trackColor={{ false: palette.muted, true: palette.primary }}
                          value={rule.active}
                        />
                      )}
                      leading={<Text tone="muted" variant="amount">{index + 1}</Text>}
                      meta={[rule.summary, rule.active ? null : t('rules.inactive'), rule.stopProcessing ? t('rules.stops') : null, rule.editable ? null : t('rules.readOnly')]}
                      moreAccessibilityLabel={t('rules.rowActions', { name: rule.name })}
                      onMorePress={() => { if (!writeBlocked && !pending) setMenuRuleId(rule.id) }}
                      onPress={() => openRule(rule)}
                      title={rule.name}
                    />
                  </View>
                ))}
              </SettingsGroup>
            )}
        </> : null}
      </SettingsSection>

      <OptionSheet
        mode="menu"
        onClose={() => setMenuRuleId(null)}
        onSelect={() => { if (menuRule) confirmDelete(menuRule) }}
        options={[{ destructive: true, label: t('rules.delete'), value: 'delete' }]}
        title={menuRule?.name ?? ''}
        visible={menuRule !== null}
      />
    </SettingsPage>
  )
}

const styles = StyleSheet.create({
  row: { paddingHorizontal: themeTokens.spacing[4] },
})
