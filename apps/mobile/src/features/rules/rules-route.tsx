import { useRouter } from 'expo-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Alert } from 'react-native'

import { mapCategories } from '@/features/categories/categories-view-model'
import { useCategories } from '@/features/categories/use-categories'
import { ApiError } from '@/lib/api/errors'

import type { RuleDto } from './rules-contract'
import { RuleApplyOffer } from './rule-apply-offer'
import { RuleEditorSheet } from './rule-editor-sheet'
import { RulePresetOffer } from './rule-preset-offer'
import { RulesScreen, type RulesViewState } from './rules-screen'
import { mapRules, type RuleListItem, type RuleSummaryLookups } from './rules-view-model'
import { useDeleteRule, useRules, useSetRuleActive } from './use-rules'

export function RulesRoute() {
  const query = useRules()
  const categoriesQuery = useCategories()
  const setActive = useSetRuleActive()
  const remove = useDeleteRule()
  const router = useRouter()
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'
  const [editing, setEditing] = useState<RuleDto | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)
  const [savedRule, setSavedRule] = useState<RuleDto | null>(null)
  const [demoLocked, setDemoLocked] = useState(false)

  const categoryViews = categoriesQuery.data ? mapCategories(categoriesQuery.data, t, locale) : []
  const categoryOptions = categoryViews.flatMap((category) => [category, ...category.children]).map((category) => ({ id: category.id, name: category.name }))
  const lookups: RuleSummaryLookups = {
    category: (categoryKey) => categoryOptions.find((category) => category.id === categoryKey)?.name,
    amount: (value) => new Intl.NumberFormat(locale, { maximumFractionDigits: 4 }).format(value),
  }

  let state: RulesViewState
  if (query.isAccessTransition) state = { status: 'access-transition' }
  else if (query.isLoading) state = { status: 'loading' }
  else if (query.data) state = { status: query.isRefreshFailure ? 'refresh-error' : 'loaded', rules: mapRules(query.data, t, lookups), refreshing: query.isRefreshing }
  else if (query.error instanceof ApiError && query.error.code === 'invalid-response') state = { status: 'invalid-response' }
  else state = { status: 'error' }

  const reportWriteFailure = (title: string, message: string) => (error: unknown) => {
    if (error instanceof ApiError && error.code === 'demo-forbidden') {
      setDemoLocked(true)
      Alert.alert(t('rules.demoWriteBlocked'))
      return
    }
    if (error instanceof ApiError && error.code === 'household-read-only') {
      Alert.alert(title, t('common.householdReadOnly'))
      return
    }
    Alert.alert(title, message)
  }

  const openRule = (rule: RuleListItem) => {
    const found = query.data?.rules.find((candidate) => candidate.ruleKey === rule.id) ?? null
    if (!found) return
    setEditing(found)
    setEditorOpen(true)
  }

  return (
    <>
      <RulesScreen
        demoLocked={demoLocked}
        onBack={() => { if (router.canGoBack()) router.back(); else router.replace('/more') }}
        onDelete={(ruleId) => remove.mutate(ruleId, { onError: reportWriteFailure(t('rules.deleteFailedTitle'), t('rules.deleteFailedMessage')) })}
        onOpenRule={openRule}
        onRetry={async () => { await query.refetch() }}
        offer={<RulePresetOffer disabled={demoLocked} />}
        onToggleActive={(ruleId, active) => setActive.mutate({ ruleId, active }, { onError: reportWriteFailure(t('rules.toggleFailedTitle'), t('rules.toggleFailedMessage')) })}
        pending={setActive.isPending || remove.isPending}
        state={state}
        writeBlocked={demoLocked}
      />
      <RuleEditorSheet
        categories={categoryOptions}
        onClose={() => { setEditorOpen(false); setEditing(null) }}
        onSaved={(rule) => { setEditorOpen(false); setEditing(null); setSavedRule(rule) }}
        rule={editing}
        seed={null}
        visible={editorOpen}
      />
      {savedRule ? <RuleApplyOffer key={savedRule.ruleKey} onClose={() => setSavedRule(null)} rule={savedRule} /> : null}
    </>
  )
}
