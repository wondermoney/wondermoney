import type { TFunction } from 'i18next'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { StyleSheet, View } from 'react-native'

import { Button } from '@/components/ui/button'
import { Sheet } from '@/components/ui/sheet'
import { Text } from '@/components/ui/text'
import { themeTokens } from '@/theme/tokens'

import type { RuleDto } from './rules-contract'
import { useRuleApply, useRuleApplyCount, type RuleApplyState } from './use-rules'

function applyMessage(state: RuleApplyState, count: number, t: TFunction): string {
  switch (state.phase) {
    case 'running':
      return t('rules.apply.running')
    case 'background':
      return t('rules.apply.continues')
    case 'done':
      return t('rules.apply.done', { count: state.changed })
    case 'error':
      return t(state.reason === 'in-progress'
        ? 'rules.apply.inProgress'
        : state.reason === 'demo' ? 'rules.apply.demo' : state.reason === 'access' ? 'rules.apply.access' : 'rules.apply.error')
    default:
      return t('rules.apply.description', { count })
  }
}

/**
 * After a rule is saved: offer to apply it to the transactions already there, as web's
 * `ApplyRulesDialog`. The count comes from the API's dry run, so it is exactly what applying
 * changes. Nothing shows when no existing transaction would change.
 */
export function RuleApplyOffer({ rule, onClose, onApplied }: { rule: RuleDto; onClose: () => void; onApplied?: () => void }) {
  const { t } = useTranslation()
  const count = useRuleApplyCount(rule.ruleKey)
  const apply = useRuleApply()
  const nothingToOffer = count.isError || (count.isSuccess && count.data === 0)
  const phase = apply.state.phase

  useEffect(() => {
    if (nothingToOffer) onClose()
  }, [nothingToOffer, onClose])

  useEffect(() => {
    if (phase === 'done') onApplied?.()
  }, [onApplied, phase])

  const open = !nothingToOffer && !count.isPending
  const running = phase === 'running'
  const finished = phase === 'done' || phase === 'error' || phase === 'background'

  return (
    <Sheet
      closeLabel={t('common.close')}
      footer={running || finished ? (
        <Button block label={t('rules.apply.close')} onPress={onClose} variant="secondary" />
      ) : (
        <View style={styles.actions}>
          <Button label={t('rules.apply.notNow')} onPress={onClose} variant="secondary" />
          <Button
            label={t('rules.apply.confirm', { count: count.data ?? 0 })}
            onPress={() => void apply.start(rule.ruleKey)}
          />
        </View>
      )}
      onClose={onClose}
      title={t('rules.apply.title', { name: rule.name })}
      visible={open}
    >
      <View style={styles.body}>
        <Text accessibilityLiveRegion="polite" variant="body">{applyMessage(apply.state, count.data ?? 0, t)}</Text>
        {phase === 'idle' ? <Text tone="muted" variant="meta">{t('rules.apply.scopeHint')}</Text> : null}
        {running || phase === 'background' ? <Text tone="muted" variant="meta">{t('rules.apply.backgroundHint')}</Text> : null}
      </View>
    </Sheet>
  )
}

const styles = StyleSheet.create({
  body: { gap: themeTokens.spacing[2], paddingBottom: themeTokens.spacing[2] },
  actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: themeTokens.spacing[2] },
})
