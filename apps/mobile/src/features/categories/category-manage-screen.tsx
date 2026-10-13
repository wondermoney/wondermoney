import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BackHandler, Pressable, ScrollView, StyleSheet, Text, TextInput, useColorScheme, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { BackControl } from '@/components/ui/back-control'
import { themeTokens, type Palette } from '@/theme/tokens'
import { textStyles } from '@/theme/typography'

import { CATEGORY_ICONS, categoryCreateWriteSchema, categoryEditWriteSchema, type CategoryCreateWrite, type CategoryEditWrite } from './categories-contract'
import { CategoryIcon } from './category-icon'
import type { CategoryWriteFailure } from './use-category-write'

type ParentOption = Readonly<{ id: number; name: string }>
export type CategoryManageReconciliation = 'checking' | 'refresh-failed' | 'create-neutral' | 'edit-applied' | 'edit-not-applied' | 'edit-not-found'

export type CategoryManageScreenProps = Readonly<{
  mode: 'create' | 'edit'
  initial?: Readonly<{ name: string; color: string; icon: string }>
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
  const { t } = useTranslation()
  const palette = themeTokens.colors[useColorScheme() === 'dark' ? 'dark' : 'light']
  const [name, setName] = useState(props.initial?.name ?? '')
  const [color, setColor] = useState(props.initial?.color ?? '#2563EB')
  const [icon, setIcon] = useState(props.initial?.icon ?? 'folder')
  const [parent, setParent] = useState<number | null>(null)
  const [reviewed, setReviewed] = useState<CategoryCreateWrite | CategoryEditWrite | null>(props.initialReview ?? null)
  const [validation, setValidation] = useState(false)
  const locked = props.reconciliation !== null
  const defaultName = props.initial?.name ?? ''
  const defaultColor = props.initial?.color ?? '#2563EB'
  const defaultIcon = props.initial?.icon ?? 'folder'
  const dirty = reviewed !== null || name !== defaultName || color !== defaultColor || icon !== defaultIcon || parent !== null
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
    setReviewed(null)
    setValidation(false)
  }, [defaultColor, defaultIcon, defaultName, props.resetReviewToken])

  useEffect(() => {
    if (!props.pending) return
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => true)
    return () => subscription.remove()
  }, [props.pending])

  if (props.unavailable === 'access-transition') return null
  if (props.unavailable) return <Shell palette={palette}><Header mode={props.mode} onBack={props.onBack} palette={palette} disabled={props.pending} /><View style={[styles.notice, { borderColor: palette.border, backgroundColor: palette.muted }]}><Text accessibilityRole={props.unavailable === 'loading' ? 'progressbar' : 'alert'} style={[styles.body, { color: palette.foreground }]}>{t(`categoryManage.states.${props.unavailable}`)}</Text>{props.unavailable !== 'system' && props.unavailable !== 'not-found' && props.unavailable !== 'loading' ? <Action label={t('common.retry')} onPress={props.onRefresh} palette={palette} /> : null}</View></Shell>

  const stageReview = () => {
    const candidate = props.mode === 'create'
      ? { name, color: color.toUpperCase(), icon, ...(parent === null ? {} : { parentCategoryKey: String(parent) }) }
      : { name, color: color.toUpperCase(), icon }
    const parsed = (props.mode === 'create' ? categoryCreateWriteSchema : categoryEditWriteSchema).safeParse(candidate)
    if (!parsed.success) { setValidation(true); return }
    setValidation(false)
    setReviewed(Object.freeze(parsed.data))
  }
  const shown = reviewed
  const warningName = props.duplicateName(name)
  const warningColor = /^#[0-9A-F]{6}$/.test(color) && props.duplicateColor(color)
  const reviewedParentKey = shown && props.mode === 'create' && 'parentCategoryKey' in shown ? shown.parentCategoryKey : undefined
  const reviewedParent = reviewedParentKey === undefined
    ? t('categoryManage.noParent')
    : props.parents.find(({ id }) => String(id) === reviewedParentKey)?.name ?? t('categoryManage.parentUnavailable')

  return <Shell palette={palette}><Header mode={props.mode} onBack={props.onBack} palette={palette} disabled={props.pending} />
    {!shown ? <View style={styles.form}>
      <Field label={t('categoryManage.name')} count={`${name.length}/255`} palette={palette}><TextInput accessibilityLabel={t('categoryManage.name')} value={name} maxLength={255} onChangeText={setName} autoCapitalize="sentences" style={[styles.input, { color: palette.foreground, borderColor: palette.border, backgroundColor: palette.card }]} /></Field>
      {warningName ? <Warning text={t('categoryManage.duplicateName')} palette={palette} /> : null}
      <Field label={t('categoryManage.color')} hint={t('categoryManage.colorHint')} palette={palette}><View style={styles.colorRow}><View accessible accessibilityLabel={t('categoryManage.colorPreview')} style={[styles.preview, { backgroundColor: /^#[0-9A-F]{6}$/.test(color) ? color : palette.primarySoft, borderColor: palette.border }]} /><TextInput accessibilityLabel={t('categoryManage.color')} value={color} maxLength={7} autoCapitalize="characters" autoCorrect={false} onChangeText={(value) => setColor(value.toUpperCase())} style={[styles.input, styles.colorInput, { color: palette.foreground, borderColor: palette.border, backgroundColor: palette.card }]} /></View></Field>
      {warningColor ? <Warning text={t('categoryManage.duplicateColor')} palette={palette} /> : null}
      <Field label={t('categoryManage.icon')} palette={palette}><View accessibilityRole="radiogroup" style={styles.choices}>{CATEGORY_ICONS.map((option) => { const iconName = t(`categoryManage.icons.${option}`, { defaultValue: option }); return <Choice key={option} selected={icon === option} label={t('categoryManage.iconChoice', { icon: iconName })} visible={<View style={styles.iconChoiceRow}><CategoryIcon icon={option} color={palette.foreground} size={16} /><Text style={[styles.choiceText, { color: palette.foreground }]}>{iconName}</Text></View>} onPress={() => setIcon(option)} palette={palette} /> })}</View></Field>
      {props.mode === 'create' ? <Field label={t('categoryManage.parent')} hint={t('categoryManage.parentHint')} palette={palette}><View accessibilityRole="radiogroup" style={styles.choices}><Choice selected={parent === null} label={t('categoryManage.noParent')} visible={t('categoryManage.noParent')} onPress={() => setParent(null)} palette={palette} />{props.parents.map((option) => <Choice key={option.id} selected={parent === option.id} label={option.name} visible={option.name} onPress={() => setParent(option.id)} palette={palette} />)}</View></Field> : <View style={[styles.notice, { backgroundColor: palette.muted, borderColor: palette.border }]}><Text style={[styles.body, { color: palette.foreground }]}>{t('categoryManage.editImpact')}</Text><Text style={[styles.small, { color: palette.mutedForeground }]}>{t('categoryManage.noReparent')}</Text></View>}
      {validation ? <Text accessibilityRole="alert" style={[styles.alert, { color: palette.destructive }]}>{t('categoryManage.validation')}</Text> : null}
      <Action label={t('categoryManage.review')} onPress={stageReview} palette={palette} />
    </View> : <View style={styles.form}>
      <Text accessibilityRole="header" style={[styles.sectionTitle, { color: palette.foreground }]}>{t('categoryManage.reviewTitle')}</Text>
      <Text style={[styles.body, { color: palette.mutedForeground }]}>{t(props.mode === 'edit' ? 'categoryManage.editImpact' : 'categoryManage.reviewHelper')}</Text>
      <View style={[styles.reviewCard, { borderColor: palette.border, backgroundColor: palette.card }]}><Review label={t('categoryManage.name')} value={shown.name ?? name.trim()} palette={palette} /><Review label={t('categoryManage.color')} value={shown.color ?? color} palette={palette} /><Review label={t('categoryManage.icon')} accessibleValue={t(`categoryManage.icons.${shown.icon ?? icon}`, { defaultValue: shown.icon ?? icon })} value={<View style={styles.iconChoiceRow}><CategoryIcon icon={shown.icon ?? icon} color={palette.foreground} size={16} /><Text style={[styles.reviewValue, { color: palette.foreground }]}>{t(`categoryManage.icons.${shown.icon ?? icon}`, { defaultValue: shown.icon ?? icon })}</Text></View>} palette={palette} />{props.mode === 'create' ? <Review label={t('categoryManage.parent')} value={reviewedParent} palette={palette} /> : null}</View>
      {props.failure && !locked ? <Text accessibilityRole="alert" style={[styles.alert, { color: palette.destructive }]}>{t(`categoryManage.failures.${props.failure}`)}</Text> : null}
      {locked ? <View style={[styles.notice, { borderColor: palette.border, backgroundColor: palette.muted }]}><Text accessibilityRole="header" style={[styles.sectionTitle, { color: palette.foreground }]}>{t('categoryManage.reconciliationTitle')}</Text><Text accessibilityRole="alert" style={[styles.body, { color: palette.foreground }]}>{t(`categoryManage.reconciliation.${props.reconciliation}`)}</Text><View style={styles.actions}><Action label={t('categoryManage.backToCategories')} onPress={props.onBack} palette={palette} secondary disabled={props.pending} />{props.reconciliation === 'refresh-failed' ? <Action label={t('categoryManage.refreshCategories')} onPress={props.onRefresh} palette={palette} /> : null}</View></View> : <View style={styles.actions}><Action label={t('categoryManage.editForm')} onPress={() => setReviewed(null)} palette={palette} secondary disabled={props.pending || props.demoLocked} /><Action label={props.pending ? t('categoryManage.saving') : t('categoryManage.confirm')} onPress={() => props.onSubmit(shown)} palette={palette} disabled={props.pending || props.demoLocked} /></View>}
    </View>}
  </Shell>
}

function Shell({ palette, children }: { palette: Palette; children: React.ReactNode }) { return <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}><View style={styles.page}>{children}</View></ScrollView></SafeAreaView> }
function Header({ mode, onBack, palette, disabled }: { mode: 'create' | 'edit'; onBack: () => void; palette: Palette; disabled: boolean }) { const { t } = useTranslation(); return <View style={styles.header}><BackControl fallback="/more" label={t('categoryManage.back')} onPress={onBack} disabled={disabled} /><View style={styles.heading}><Text accessibilityRole="header" style={[styles.title, { color: palette.foreground }]}>{t(`categoryManage.${mode}Title`)}</Text><Text style={[styles.body, { color: palette.mutedForeground }]}>{t(`categoryManage.${mode}Helper`)}</Text></View></View> }
function Field({ label, count, hint, palette, children }: { label: string; count?: string; hint?: string; palette: Palette; children: React.ReactNode }) { return <View style={styles.field}><View style={styles.labelRow}><Text style={[styles.label, { color: palette.foreground }]}>{label}</Text>{count ? <Text style={[styles.small, { color: palette.mutedForeground }]}>{count}</Text> : null}</View>{children}{hint ? <Text style={[styles.small, { color: palette.mutedForeground }]}>{hint}</Text> : null}</View> }
function Warning({ text, palette }: { text: string; palette: Palette }) { return <Text accessibilityRole="alert" style={[styles.warning, { color: palette.foreground, borderColor: palette.border }]}>{text}</Text> }
function Choice({ selected, label, visible, onPress, palette }: { selected: boolean; label: string; visible: ReactNode; onPress: () => void; palette: Palette }) { return <Pressable accessibilityRole="radio" accessibilityLabel={label} accessibilityState={{ selected }} onPress={onPress} style={[styles.choice, { borderColor: selected ? palette.primary : palette.border, backgroundColor: selected ? palette.primarySoft : palette.card }]}>{typeof visible === 'string' ? <Text style={[styles.choiceText, { color: palette.foreground }]}>{visible}</Text> : visible}</Pressable> }
function Review({ label, value, accessibleValue, palette }: { label: string; value: ReactNode; accessibleValue?: string; palette: Palette }) { return <View accessible accessibilityLabel={`${label}: ${accessibleValue ?? (typeof value === 'string' ? value : '')}`} style={styles.reviewRow}><Text style={[styles.small, { color: palette.mutedForeground }]}>{label}</Text>{typeof value === 'string' ? <Text style={[styles.reviewValue, { color: palette.foreground }]}>{value}</Text> : value}</View> }
function Action({ label, onPress, palette, secondary = false, disabled = false, busy = false }: { label: string; onPress: () => void | Promise<void>; palette: Palette; secondary?: boolean; disabled?: boolean; busy?: boolean }) { return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled, busy }} disabled={disabled} onPress={() => void onPress()} style={({ pressed }) => [styles.button, { borderColor: palette.primary, backgroundColor: secondary ? 'transparent' : palette.primary }, (pressed || disabled) && styles.pressed]}><Text allowFontScaling style={[styles.buttonText, { color: secondary ? palette.primary : palette.background }]}>{label}</Text></Pressable> }

const styles = StyleSheet.create({
  safe: { flex: 1 }, content: { flexGrow: 1, padding: themeTokens.layout.screenPadding }, page: { width: '100%', maxWidth: 680, alignSelf: 'center', gap: themeTokens.layout.blockGap }, header: { flexDirection: 'row', alignItems: 'flex-start', flexWrap: 'wrap', gap: themeTokens.spacing[4] }, heading: { flex: 1, minWidth: 220, gap: themeTokens.spacing[1] }, title: { ...textStyles.title, fontWeight: '700' as const }, sectionTitle: { ...textStyles.section }, body: { ...textStyles.body }, small: { ...textStyles.label }, form: { gap: themeTokens.spacing[4] }, field: { gap: themeTokens.spacing[2] }, labelRow: { flexDirection: 'row', justifyContent: 'space-between', gap: themeTokens.spacing[3] }, label: { ...textStyles.bodyStrong, fontWeight: '600' as const }, input: { ...textStyles.body, minHeight: themeTokens.touchTarget.minimum, borderWidth: 1, borderRadius: themeTokens.radius.md, paddingHorizontal: themeTokens.spacing[3] }, colorRow: { flexDirection: 'row', alignItems: 'center', gap: themeTokens.spacing[3] }, colorInput: { flex: 1, fontFamily: themeTokens.typography.roles.data.fontFamily }, preview: { width: 48, height: 48, borderRadius: 14, borderWidth: 1 }, choices: { flexDirection: 'row', flexWrap: 'wrap', gap: themeTokens.spacing[2] }, choice: { minHeight: themeTokens.touchTarget.minimum, borderWidth: 1, borderRadius: themeTokens.radius.md, paddingHorizontal: themeTokens.spacing[3], alignItems: 'center', justifyContent: 'center' }, choiceText: { ...textStyles.meta }, iconChoiceRow: { flexDirection: 'row', alignItems: 'center', gap: themeTokens.spacing[2] }, warning: { ...textStyles.meta, borderWidth: 1, borderRadius: themeTokens.radius.md, padding: themeTokens.spacing[3] }, alert: { ...textStyles.body }, notice: { borderWidth: 1, borderRadius: themeTokens.radius.lg, padding: themeTokens.spacing[4], gap: themeTokens.spacing[3] }, reviewCard: { borderWidth: 1, borderRadius: themeTokens.radius.xl, padding: themeTokens.spacing[4], gap: themeTokens.spacing[3] }, reviewRow: { gap: themeTokens.spacing[1] }, reviewValue: { ...textStyles.action }, actions: { flexDirection: 'row', justifyContent: 'flex-end', flexWrap: 'wrap', gap: themeTokens.spacing[3] }, button: { minHeight: themeTokens.touchTarget.minimum, borderWidth: 1, borderRadius: themeTokens.radius.md, paddingHorizontal: themeTokens.spacing[4], alignItems: 'center', justifyContent: 'center' }, buttonText: { ...textStyles.bodyStrong, fontWeight: '600' as const }, pressed: { opacity: 0.55 },
})
