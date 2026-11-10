import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BackHandler, ScrollView, StyleSheet, View } from 'react-native'

import { Button } from '@/components/ui/button'
import { EntityMark } from '@/components/ui/entity-mark'
import { FormBar } from '@/components/ui/form-bar'
import { FormGroup, FormSelectRow, FormSwitchRow, FormTextRow } from '@/components/ui/form-row'
import { SafeAreaView } from '@/components/ui/screen-safe-area'
import { Text } from '@/components/ui/text'
import { FormNotice } from '@/features/transactions/form-field'
import { themeTokens } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'

import { CATEGORY_ICONS, categoryCreateWriteSchema, categoryEditWriteSchema, type CategoryCreateWrite, type CategoryEditWrite } from './categories-contract'
import type { CategoryWriteFailure } from './use-category-write'

type ParentOption = Readonly<{ id: number; name: string; countsAsSpending?: boolean }>
export type CategoryManageReconciliation = 'checking' | 'refresh-failed' | 'create-neutral' | 'edit-applied' | 'edit-not-applied' | 'edit-not-found'

export type CategoryManageScreenProps = Readonly<{
  mode: 'create' | 'edit'
  initial?: Readonly<{ name: string; color: string; icon: string; countsAsSpending?: boolean }>
  /** Edit only: false when the category sits under a main category that does not count as spending. */
  parentCountsAsSpending?: boolean
  initialReview?: Readonly<CategoryCreateWrite | CategoryEditWrite>
  parents: readonly ParentOption[]
  duplicateName: (name: string) => boolean
  duplicateColor: (color: string) => boolean
  pending: boolean
  demoLocked?: boolean
  failure: CategoryWriteFailure | null
  reconciliation: CategoryManageReconciliation | null
  resetReviewToken?: number
  unavailable?: 'loading' | 'error' | 'invalid-response' | 'not-found' | 'system' | 'access-transition'
  onBack: () => void
  onDirtyChange?: (dirty: boolean) => void
  onRefresh: () => Promise<void>
  onSubmit: (payload: CategoryCreateWrite | CategoryEditWrite) => Promise<void>
}>

export function CategoryManageScreen(props: CategoryManageScreenProps) {
  const { t, i18n } = useTranslation()
  const palette = usePalette()
  const [name, setName] = useState(props.initial?.name ?? '')
  const [color, setColor] = useState(props.initial?.color ?? '#2563EB')
  const [icon, setIcon] = useState(props.initial?.icon ?? 'folder')
  const [parent, setParent] = useState<number | null>(null)
  const [counts, setCounts] = useState(props.initial?.countsAsSpending ?? true)
  const [reviewed, setReviewed] = useState<CategoryCreateWrite | CategoryEditWrite | null>(props.initialReview ?? null)
  const [validation, setValidation] = useState(false)
  const locked = props.reconciliation !== null
  const defaultName = props.initial?.name ?? ''
  const defaultColor = props.initial?.color ?? '#2563EB'
  const defaultIcon = props.initial?.icon ?? 'folder'
  const defaultCounts = props.initial?.countsAsSpending ?? true
  const dirty = reviewed !== null || name !== defaultName || color !== defaultColor || icon !== defaultIcon || parent !== null || counts !== defaultCounts
  const previousResetToken = useRef(props.resetReviewToken)
  const onDirtyChange = props.onDirtyChange

  useEffect(() => { onDirtyChange?.(dirty) }, [dirty, onDirtyChange])
  useEffect(() => {
    if (props.resetReviewToken === undefined || previousResetToken.current === props.resetReviewToken) return
    previousResetToken.current = props.resetReviewToken
    setName(defaultName)
    setColor(defaultColor)
    setIcon(defaultIcon)
    setParent(null)
    setCounts(defaultCounts)
    setReviewed(null)
    setValidation(false)
  }, [defaultColor, defaultCounts, defaultIcon, defaultName, props.resetReviewToken])

  useEffect(() => {
    if (!props.pending) return
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => true)
    return () => subscription.remove()
  }, [props.pending])

  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'
  const title = t(`categoryManage.${props.mode}Title`)
  if (props.unavailable === 'access-transition') return null
  if (props.unavailable) {
    return <Shell bar={<FormBar closeDisabled={props.pending} closeLabel={t('common.close')} onClose={props.onBack} title={title} />}>
      <View style={styles.block}>
        <Text accessibilityRole={props.unavailable === 'loading' ? 'progressbar' : 'alert'} tone={props.unavailable === 'loading' ? 'muted' : 'default'} variant="body">{t(`categoryManage.states.${props.unavailable}`)}</Text>
        {props.unavailable !== 'system' && props.unavailable !== 'not-found' && props.unavailable !== 'loading' ? <View style={styles.actions}><Button label={t('common.retry')} onPress={props.onRefresh} variant="secondary" /></View> : null}
      </View>
    </Shell>
  }

  // Under a main category that does not count as spending, nothing beneath it counts either.
  const parentBlocksSpending = props.mode === 'create'
    ? parent !== null && props.parents.find(({ id }) => id === parent)?.countsAsSpending === false
    : props.parentCountsAsSpending === false
  const effectiveCounts = parentBlocksSpending ? false : counts
  const candidate = props.mode === 'create'
    // Counting is the server's default, so only "does not count" is sent.
    ? { name, color: color.toUpperCase(), icon, ...(effectiveCounts ? {} : { countsAsSpending: false }), ...(parent === null ? {} : { parentCategoryKey: String(parent) }) }
    : { name, color: color.toUpperCase(), icon, ...(counts === defaultCounts ? {} : { countsAsSpending: counts }) }
  const parsedCandidate = (props.mode === 'create' ? categoryCreateWriteSchema : categoryEditWriteSchema).safeParse(candidate)
  const stageReview = () => {
    if (!parsedCandidate.success) { setValidation(true); return }
    setValidation(false)
    setReviewed(Object.freeze(parsedCandidate.data))
  }
  const shown = reviewed
  const colorValid = HEX_COLOR.test(color)
  const warningName = props.duplicateName(name)
  const warningColor = colorValid && props.duplicateColor(color)
  // Errors show for what was entered and is wrong; an empty field only keeps ✓ disabled.
  const nameError = name.length > 0 && (name.trim().length === 0 || name.trim().length > 255) ? t('categoryManage.nameError') : null
  const colorError = color.length > 0 && !colorValid ? t('categoryManage.colorHint') : null
  const iconLabel = (value: string) => {
    const label = t(`categoryManage.icons.${value}`, { defaultValue: value })
    return label.charAt(0).toLocaleUpperCase(locale) + label.slice(1)
  }
  const mark = (value: string, swatch: string) => <EntityMark icon={{ name: value, bgColor: HEX_COLOR.test(swatch) ? swatch : null }} size="sm" />
  const reviewedParentKey = shown && props.mode === 'create' && 'parentCategoryKey' in shown ? shown.parentCategoryKey : undefined
  const reviewedParent = reviewedParentKey === undefined
    ? t('categoryManage.noParent')
    : props.parents.find(({ id }) => String(id) === reviewedParentKey)?.name ?? t('categoryManage.parentUnavailable')
  const confirmable = !props.pending && !props.demoLocked

  const bar = <FormBar
    closeDisabled={props.pending}
    closeLabel={t('common.close')}
    onClose={props.onBack}
    onSave={!shown ? stageReview : locked ? undefined : () => void props.onSubmit(shown)}
    saveDisabled={!shown ? !parsedCandidate.success || props.pending : !confirmable}
    saveLabel={!shown ? t('categoryManage.review') : props.pending ? t('categoryManage.saving') : t('categoryManage.confirm')}
    saving={shown !== null && props.pending}
    title={title}
  />

  return <Shell bar={bar}>
    {!shown ? <View style={styles.form}>
      <Text tone="muted" variant="meta">{t(`categoryManage.${props.mode}Helper`)}</Text>
      <FormGroup>
        <FormTextRow key="name" accessibilityLabel={t('categoryManage.name')} autoCapitalize="sentences" error={nameError} hint={warningName ? t('categoryManage.duplicateName') : null} label={t('categoryManage.name')} maxLength={255} onChangeText={setName} value={name} />
        <FormTextRow key="color" accessibilityLabel={t('categoryManage.color')} autoCapitalize="characters" autoCorrect={false} error={colorError} hint={warningColor ? t('categoryManage.duplicateColor') : t('categoryManage.colorHint')} label={t('categoryManage.color')} maxLength={7} onChangeText={(value) => setColor(value.toUpperCase())} value={color} />
        <FormSelectRow
          key="icon"
          label={t('categoryManage.icon')}
          onChange={setIcon}
          options={CATEGORY_ICONS.map((option) => ({ value: option, label: iconLabel(option), leading: mark(option, color) }))}
          placeholder={t('transactionCreate.choose')}
          value={icon}
        />
        {props.mode === 'create' ? (
          // 0 stands for "no main category": category ids are positive.
          <FormSelectRow
            key="parent"
            hint={t('categoryManage.parentHint')}
            label={t('categoryManage.parent')}
            onChange={(id) => setParent(id === 0 ? null : id)}
            options={[{ value: 0, label: t('categoryManage.noParent') }, ...props.parents.map((option) => ({ value: option.id, label: option.name }))]}
            placeholder={t('categoryManage.noParent')}
            value={parent ?? 0}
          />
        ) : null}
      </FormGroup>
      <FormGroup>
        <FormSwitchRow
          disabled={parentBlocksSpending}
          hint={parentBlocksSpending ? t('categoryManage.countsAsSpendingParentOff') : t('categoryManage.countsAsSpendingHint')}
          label={t('categoryManage.countsAsSpending')}
          onValueChange={setCounts}
          testID="category-counts-as-spending"
          value={effectiveCounts}
        />
      </FormGroup>
      {props.mode === 'edit' ? <View style={styles.block}><Text variant="body">{t('categoryManage.editImpact')}</Text><Text tone="muted" variant="meta">{t('categoryManage.noReparent')}</Text></View> : null}
      {validation ? <FormNotice tone="destructive">{t('categoryManage.validation')}</FormNotice> : null}
    </View> : <View style={styles.form}>
      <View style={styles.block}>
        <Text accessibilityRole="header" variant="heading">{t('categoryManage.reviewTitle')}</Text>
        <Text tone="muted" variant="meta">{t(props.mode === 'edit' ? 'categoryManage.editImpact' : 'categoryManage.reviewHelper')}</Text>
      </View>
      <View style={[styles.review, { borderColor: palette.border }]}>
        <Review first label={t('categoryManage.name')} value={shown.name ?? name.trim()} />
        <Review label={t('categoryManage.color')} value={shown.color ?? color} data />
        <Review label={t('categoryManage.icon')} leading={mark(shown.icon ?? icon, shown.color ?? color)} value={iconLabel(shown.icon ?? icon)} />
        {props.mode === 'create' ? <Review label={t('categoryManage.parent')} value={reviewedParent} /> : null}
        <Review label={t('categoryManage.countsAsSpending')} value={t((shown.countsAsSpending ?? effectiveCounts) ? 'categoryManage.countsYes' : 'categoryManage.countsNo')} />
      </View>
      {props.failure && !locked ? <FormNotice tone="destructive">{t(`categoryManage.failures.${props.failure}`)}</FormNotice> : null}
      {locked ? <View style={styles.block}>
        <Text accessibilityRole="header" variant="bodyStrong">{t('categoryManage.reconciliationTitle')}</Text>
        <FormNotice>{t(`categoryManage.reconciliation.${props.reconciliation}`)}</FormNotice>
        <View style={styles.actions}>
          <Button disabled={props.pending} label={t('categoryManage.backToCategories')} onPress={props.onBack} variant="secondary" />
          {props.reconciliation === 'refresh-failed' ? <Button label={t('categoryManage.refreshCategories')} onPress={props.onRefresh} /> : null}
        </View>
      </View> : <View style={styles.actions}><Button disabled={!confirmable} label={t('categoryManage.editForm')} onPress={() => setReviewed(null)} variant="secondary" /></View>}
    </View>}
  </Shell>
}

const HEX_COLOR = /^#[0-9A-F]{6}$/

function Shell({ bar, children }: { bar: ReactNode; children: ReactNode }) {
  const palette = usePalette()
  return <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]}>{bar}<ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}><View style={styles.page}>{children}</View></ScrollView></SafeAreaView>
}

function Review({ label, value, leading, data = false, first = false }: { label: string; value: string; leading?: ReactNode; data?: boolean; first?: boolean }) {
  const palette = usePalette()
  return (
    <View accessible accessibilityLabel={`${label}: ${value}`} style={[styles.reviewRow, !first && { borderTopWidth: 1, borderTopColor: palette.border }]}>
      <Text style={styles.reviewLabel} variant="body">{label}</Text>
      <View style={styles.reviewValue}>{leading}<Text style={styles.reviewText} variant={data ? 'amountBase' : 'body'}>{value}</Text></View>
    </View>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { flexGrow: 1, paddingHorizontal: themeTokens.layout.screenPadding, paddingBottom: themeTokens.spacing[10] },
  page: { width: '100%', maxWidth: 680, alignSelf: 'center', gap: themeTokens.spacing[4] },
  form: { gap: themeTokens.spacing[4] },
  block: { gap: themeTokens.spacing[2] },
  review: { borderWidth: 1, borderRadius: themeTokens.radius.xl },
  reviewRow: { minHeight: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: themeTokens.spacing[4], paddingHorizontal: themeTokens.spacing[4], paddingVertical: themeTokens.spacing[3] },
  reviewLabel: { flexShrink: 0 },
  reviewValue: { flexShrink: 1, flexDirection: 'row', alignItems: 'center', gap: themeTokens.spacing[2] },
  reviewText: { flexShrink: 1, textAlign: 'right' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: themeTokens.spacing[2] },
})
