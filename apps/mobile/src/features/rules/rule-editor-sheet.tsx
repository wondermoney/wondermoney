import type { TFunction } from 'i18next'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { StyleSheet, View } from 'react-native'

import { Button } from '@/components/ui/button'
import { FormGroup, FormSelectRow, FormTextRow } from '@/components/ui/form-row'
import { Notice } from '@/components/ui/notice'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { Sheet } from '@/components/ui/sheet'
import { Text } from '@/components/ui/text'
import { useDebouncedValue } from '@/features/markets/use-debounced-value'
import { themeTokens } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'

import {
  MAX_RULE_CONDITIONS,
  NUMBER_OPERATORS,
  RULE_NAME_MAX_LENGTH,
  RULE_TEXT_MAX_LENGTH,
  TEXT_OPERATORS,
  type RuleDraft,
  type RuleDto,
} from './rules-contract'
import {
  createActionDraft,
  createConditionDraft,
  defaultOperator,
  EDITABLE_ACTION_TYPES,
  EDITABLE_CONDITION_FIELDS,
  emptyRuleForm,
  formToRuleInput,
  isRuleEditable,
  ruleEditorDraft,
  ruleToEditorForm,
  type EditableActionType,
  type EditableConditionField,
  type RuleActionDraft,
  type RuleConditionDraft,
  type RuleEditorForm,
  type RuleFormProblems,
  type RuleRowProblem,
} from './rules-view-model'
import { useCreateRule, useRulePreview, useUpdateRule } from './use-rules'

/** How long the editor waits after the last edit before asking for a new preview. */
const PREVIEW_DEBOUNCE_MS = 400

export type RuleCategoryOption = Readonly<{ id: number; name: string }>

const EMPTY_PROBLEMS: RuleFormProblems = { conditions: {}, actions: {}, duplicateActions: false }

/**
 * Create or edit one rule, as web's `RuleEditorDialog`: the common subset of conditions and
 * actions, and a live count of the transactions the unsaved rule would match and change.
 *
 * A rule outside that subset is never opened here (`RulesScreen` shows "edit on web" instead);
 * the read-only branch is the guard for a caller that tries anyway.
 */
export function RuleEditorSheet({
  visible,
  rule,
  seed,
  categories,
  onClose,
  onSaved,
}: {
  visible: boolean
  /** The rule being edited, or null when creating. */
  rule: RuleDto | null
  /** The pre-filled form for a rule created from a transaction. */
  seed: RuleEditorForm | null
  categories: readonly RuleCategoryOption[]
  onClose: () => void
  onSaved: (rule: RuleDto) => void
}) {
  const { t } = useTranslation()
  return (
    <Sheet
      closeLabel={t('common.close')}
      onClose={onClose}
      title={rule ? t('rules.editor.editTitle') : t('rules.editor.createTitle')}
      visible={visible}
    >
      {visible ? (
        <RuleEditorBody
          key={rule ? `rule-${rule.ruleKey}` : seed ? 'seed' : 'new'}
          categories={categories}
          onClose={onClose}
          onSaved={onSaved}
          rule={rule}
          seed={seed}
        />
      ) : null}
    </Sheet>
  )
}

function RuleEditorBody({
  rule,
  seed,
  categories,
  onClose,
  onSaved,
}: {
  rule: RuleDto | null
  seed: RuleEditorForm | null
  categories: readonly RuleCategoryOption[]
  onClose: () => void
  onSaved: (rule: RuleDto) => void
}) {
  const { t, i18n } = useTranslation()
  const palette = usePalette()
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'
  const [form, setForm] = useState<RuleEditorForm>(() => (rule ? ruleToEditorForm(rule) : null) ?? seed ?? emptyRuleForm())
  const [problems, setProblems] = useState<RuleFormProblems>(EMPTY_PROBLEMS)
  const [saveFailed, setSaveFailed] = useState(false)
  const create = useCreateRule()
  const update = useUpdateRule()
  const pending = create.isPending || update.isPending
  const readOnly = rule !== null && !isRuleEditable(rule)

  // Serialized so an unchanged rule is the same query, whatever re-rendered it.
  const draftKey = useMemo(() => {
    const draft = ruleEditorDraft(form, locale)
    return draft ? JSON.stringify(draft) : null
  }, [form, locale])
  const debouncedKey = useDebouncedValue(draftKey, PREVIEW_DEBOUNCE_MS)
  const debouncedDraft = useMemo(() => (debouncedKey ? JSON.parse(debouncedKey) as RuleDraft : null), [debouncedKey])
  const preview = useRulePreview(readOnly ? null : debouncedDraft)

  const patch = (next: Partial<RuleEditorForm>) => setForm((current) => ({ ...current, ...next }))
  // Editing a row clears its own error, so the message goes when the value does.
  const clearProblem = (kind: 'conditions' | 'actions', id: string) => setProblems((current) => {
    if (!(id in current[kind])) return current
    const rows = { ...current[kind] }
    delete rows[id]
    return { ...current, [kind]: rows }
  })
  const changeCondition = (id: string, next: RuleConditionDraft) => { clearProblem('conditions', id); patch({ conditions: form.conditions.map((row) => (row.id === id ? next : row)) }) }
  const removeCondition = (id: string) => patch({ conditions: form.conditions.filter((row) => row.id !== id) })
  const changeAction = (id: string, next: RuleActionDraft) => { clearProblem('actions', id); patch({ actions: form.actions.map((row) => (row.id === id ? next : row)) }) }
  const removeAction = (id: string) => patch({ actions: form.actions.filter((row) => row.id !== id) })

  const submit = async () => {
    const conversion = formToRuleInput(form, locale)
    if (!conversion.ok) {
      setProblems(conversion.problems)
      return
    }
    setProblems(EMPTY_PROBLEMS)
    setSaveFailed(false)
    try {
      const saved = rule
        ? await update.mutateAsync({ ruleId: rule.ruleKey, input: conversion.input })
        : await create.mutateAsync(conversion.input)
      onSaved(saved)
    } catch {
      setSaveFailed(true)
    }
  }

  if (readOnly) {
    return (
      <View style={styles.form}>
        <Notice message={t('rules.editor.readOnlyMessage')} title={t('rules.editor.readOnlyTitle')} />
        <Button label={t('common.close')} onPress={onClose} variant="secondary" />
      </View>
    )
  }

  const previewText = !draftKey
    ? t('rules.preview.incomplete')
    : preview.isError && !preview.data
      ? t('rules.preview.error')
      : !preview.data
        ? t('rules.preview.loading')
        : preview.data.matchCount === 0
          ? t('rules.preview.matches', { count: 0 })
          : `${t('rules.preview.matches', { count: preview.data.matchCount })} · ${t('rules.preview.changes', { count: preview.data.changeCount })}`

  return (
    <View style={styles.form}>
      <Text tone="muted" variant="meta">{t('rules.editor.description')}</Text>

      <FormGroup>
        <FormTextRow
          accessibilityLabel={t('rules.editor.name')}
          autoCapitalize="sentences"
          editable={!pending}
          error={problems.name ? t('rules.editor.nameRequired') : null}
          label={t('rules.editor.name')}
          maxLength={RULE_NAME_MAX_LENGTH}
          onChangeText={(name) => patch({ name })}
          placeholder={t('rules.editor.namePlaceholder')}
          value={form.name}
        />
      </FormGroup>

      {form.conditions.length > 1 ? (
        <View style={styles.block}>
          <Text variant="metaStrong">{t('rules.editor.match')}</Text>
          <SegmentedControl
            accessibilityLabel={t('rules.editor.match')}
            fill
            onChange={(match) => patch({ match })}
            options={[
              { value: 'all', label: t('rules.editor.matchAll') },
              { value: 'any', label: t('rules.editor.matchAny') },
            ]}
            value={form.match}
          />
        </View>
      ) : null}

      <View style={styles.block}>
        <Text accessibilityRole="header" variant="bodyStrong">{t('rules.editor.conditions')}</Text>
        {form.conditions.map((condition, index) => (
          <ConditionEditor
            canRemove={form.conditions.length > 1}
            condition={condition}
            disabled={pending}
            index={index}
            key={condition.id}
            onChange={(next) => changeCondition(condition.id, next)}
            onRemove={() => removeCondition(condition.id)}
            problem={problems.conditions[condition.id]}
          />
        ))}
        <Button
          disabled={pending || form.conditions.length >= MAX_RULE_CONDITIONS}
          icon="plus"
          label={t('rules.editor.addCondition')}
          onPress={() => patch({ conditions: [...form.conditions, createConditionDraft()] })}
          size="sm"
          variant="ghost"
        />
      </View>

      <View style={styles.block}>
        <Text accessibilityRole="header" variant="bodyStrong">{t('rules.editor.actions')}</Text>
        {form.actions.map((action, index) => (
          <ActionEditor
            action={action}
            canRemove={form.actions.length > 1}
            categories={categories}
            disabled={pending}
            index={index}
            key={action.id}
            onChange={(next) => changeAction(action.id, next)}
            onRemove={() => removeAction(action.id)}
            problem={problems.actions[action.id]}
          />
        ))}
        <Button
          disabled={pending || form.actions.length >= EDITABLE_ACTION_TYPES.length}
          icon="plus"
          label={t('rules.editor.addAction')}
          onPress={() => patch({ actions: [...form.actions, createActionDraft()] })}
          size="sm"
          variant="ghost"
        />
      </View>

      <View style={[styles.preview, { borderColor: palette.border }]}>
        <Text variant="metaStrong">{t('rules.preview.title')}</Text>
        <Text accessibilityLiveRegion="polite" variant="meta">{previewText}</Text>
        <Text tone="muted" variant="label">{t('rules.preview.scopeHint')}</Text>
      </View>

      {problems.duplicateActions ? <Notice message={t('rules.editor.duplicateActions')} tone="destructive" /> : null}
      {saveFailed ? <Notice message={t('rules.editor.saveFailed')} tone="destructive" /> : null}

      <Button
        block
        disabled={pending}
        label={pending ? t('rules.editor.saving') : t('rules.editor.save')}
        onPress={() => void submit()}
        testID="rule-editor-save"
      />
    </View>
  )
}

function problemMessage(t: TFunction, problem: RuleRowProblem | undefined): string | null {
  return problem ? t(`rules.editor.${problem}`) : null
}

function ConditionEditor({
  condition,
  index,
  problem,
  canRemove,
  disabled,
  onChange,
  onRemove,
}: {
  condition: RuleConditionDraft
  index: number
  problem?: RuleRowProblem
  canRemove: boolean
  disabled: boolean
  onChange: (next: RuleConditionDraft) => void
  onRemove: () => void
}) {
  const { t } = useTranslation()
  const position = index + 1
  const operators = condition.field === 'amount' ? [...NUMBER_OPERATORS, 'between'] : TEXT_OPERATORS
  const changeField = (field: EditableConditionField) => onChange({ ...condition, field, operator: defaultOperator(field), value: '', min: '', max: '' })
  return (
    <View style={styles.condition}>
      <FormGroup>
        <FormSelectRow
          disabled={disabled}
          label={t('rules.editor.fieldFor', { index: position })}
          onChange={changeField}
          options={EDITABLE_CONDITION_FIELDS.map((field) => ({ label: t(`rules.fields.${field}`), value: field }))}
          placeholder={t('rules.editor.choose')}
          value={condition.field}
        />
        <FormSelectRow
          disabled={disabled}
          label={t('rules.editor.operatorFor', { index: position })}
          onChange={(operator) => onChange({ ...condition, operator })}
          options={operators.map((operator) => ({ label: t(`rules.operators.${operator}`), value: operator }))}
          placeholder={t('rules.editor.choose')}
          value={condition.operator}
        />
        {condition.field === 'description' ? (
          <FormSelectRow
            disabled={disabled}
            label={t('rules.editor.sourceFor', { index: position })}
            onChange={(source) => onChange({ ...condition, source })}
            options={[
              { label: t('rules.editor.sourceCleaned'), value: 'cleaned' },
              { label: t('rules.editor.sourceRaw'), value: 'raw' },
            ]}
            placeholder={t('rules.editor.choose')}
            value={condition.source}
          />
        ) : null}
        {condition.field === 'amount' && condition.operator === 'between' ? (
          <>
            <FormTextRow
              accessibilityLabel={t('rules.editor.min')}
              editable={!disabled}
              error={problemMessage(t, problem)}
              keyboardType="decimal-pad"
              label={t('rules.editor.min')}
              onChangeText={(min) => onChange({ ...condition, min })}
              value={condition.min}
            />
            <FormTextRow
              accessibilityLabel={t('rules.editor.max')}
              editable={!disabled}
              keyboardType="decimal-pad"
              label={t('rules.editor.max')}
              onChangeText={(max) => onChange({ ...condition, max })}
              value={condition.max}
            />
          </>
        ) : (
          <FormTextRow
            accessibilityLabel={t('rules.editor.valueFor', { index: position })}
            autoCapitalize="none"
            editable={!disabled}
            error={problemMessage(t, problem)}
            keyboardType={condition.field === 'amount' ? 'decimal-pad' : 'default'}
            label={t('rules.editor.valueFor', { index: position })}
            maxLength={condition.field === 'amount' ? undefined : RULE_TEXT_MAX_LENGTH}
            onChangeText={(value) => onChange({ ...condition, value })}
            value={condition.value}
          />
        )}
      </FormGroup>
      {canRemove ? (
        <Button
          disabled={disabled}
          icon="trash"
          label={t('rules.editor.removeCondition', { index: position })}
          onPress={onRemove}
          size="sm"
          variant="ghost"
        />
      ) : null}
    </View>
  )
}

function ActionEditor({
  action,
  index,
  problem,
  canRemove,
  disabled,
  categories,
  onChange,
  onRemove,
}: {
  action: RuleActionDraft
  index: number
  problem?: RuleRowProblem
  canRemove: boolean
  disabled: boolean
  categories: readonly RuleCategoryOption[]
  onChange: (next: RuleActionDraft) => void
  onRemove: () => void
}) {
  const { t } = useTranslation()
  const position = index + 1
  return (
    <View style={styles.condition}>
      <FormGroup>
        <FormSelectRow
          disabled={disabled}
          label={t('rules.editor.actionFor', { index: position })}
          onChange={(type: EditableActionType) => onChange({ ...action, type })}
          options={EDITABLE_ACTION_TYPES.map((type) => ({ label: t(`rules.actions.${type}`), value: type }))}
          placeholder={t('rules.editor.choose')}
          value={action.type}
        />
        {action.type === 'set_category' ? (
          <FormSelectRow
            disabled={disabled}
            error={problemMessage(t, problem)}
            label={t('rules.editor.category')}
            onChange={(categoryId) => onChange({ ...action, categoryId: String(categoryId) })}
            options={categories.map((category) => ({ label: category.name, value: category.id }))}
            placeholder={t('rules.editor.choose')}
            value={action.categoryId === '' ? null : Number(action.categoryId)}
          />
        ) : null}
        {action.type === 'set_merchant' ? (
          <FormTextRow
            accessibilityLabel={t('rules.editor.merchant')}
            autoCapitalize="words"
            editable={!disabled}
            error={problemMessage(t, problem)}
            label={t('rules.editor.merchant')}
            maxLength={RULE_TEXT_MAX_LENGTH}
            onChangeText={(merchant) => onChange({ ...action, merchant })}
            placeholder={t('rules.editor.merchantPlaceholder')}
            value={action.merchant}
          />
        ) : null}
      </FormGroup>
      {canRemove ? (
        <Button
          disabled={disabled}
          icon="trash"
          label={t('rules.editor.removeAction', { index: position })}
          onPress={onRemove}
          size="sm"
          variant="ghost"
        />
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  form: { gap: themeTokens.spacing[4], paddingBottom: themeTokens.spacing[4] },
  block: { gap: themeTokens.spacing[2] },
  condition: { gap: themeTokens.spacing[1] },
  preview: { borderWidth: 1, borderRadius: themeTokens.radius.md, padding: themeTokens.spacing[4], gap: themeTokens.spacing[1] },
})
