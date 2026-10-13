import { useTranslation } from 'react-i18next'
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, useColorScheme, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/page-header'
import { themeTokens, type Palette } from '@/theme/tokens'
import { textStyles } from '@/theme/typography'

import { CategoryIcon } from './category-icon'
import type { CategoryViewModel } from './categories-view-model'

export type CategoriesViewState =
  | { status: 'loading' | 'error' | 'invalid-response' | 'access-transition' }
  | { status: 'loaded' | 'refresh-error'; categories: readonly CategoryViewModel[]; refreshing?: boolean }

export function CategoriesScreen({ state, createBlocked = false, demoLocked = false, onBack, onRetry, onCreate = () => undefined, onEdit = () => undefined }: { state: CategoriesViewState; createBlocked?: boolean; demoLocked?: boolean; onBack: () => void; onRetry: () => void | Promise<void>; onCreate?: () => void; onEdit?: (categoryId: number) => void }) {
  const { t } = useTranslation()
  const palette = themeTokens.colors[useColorScheme() === 'dark' ? 'dark' : 'light']
  if (state.status === 'access-transition') return null
  const loaded = state.status === 'loaded' || state.status === 'refresh-error'
  return <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]}>
    <ScrollView
      contentContainerStyle={styles.content}
      refreshControl={loaded ? <RefreshControl refreshing={Boolean(state.refreshing)} onRefresh={onRetry} tintColor={palette.primary} /> : undefined}
    >
      <View style={styles.page}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('categories.back')} onPress={onBack} style={styles.action}><Text allowFontScaling style={[styles.actionText, { color: palette.primary }]}>{t('categories.back')}</Text></Pressable>
        <View style={styles.heading}>
          <PageHeader palette={palette}
            helpText={t('categories.helper')} title={t('categories.title')} />
          <Button label={t('categories.create')} onPress={onCreate} palette={palette} variant="primary" disabled={createBlocked || !loaded} style={styles.createButton} />
          {createBlocked ? <Text accessibilityRole="alert" allowFontScaling style={[styles.message, { color: palette.mutedForeground }]}>{t(demoLocked ? 'categories.demoWriteBlocked' : 'categories.writeBlocked')}</Text> : null}
        </View>
        {state.status === 'loading' ? <Text accessibilityRole="progressbar" accessibilityLabel={t('categories.loading')} allowFontScaling style={[styles.message, { color: palette.mutedForeground }]}>{t('categories.loading')}</Text> : null}
        {state.status === 'error' || state.status === 'invalid-response' ? <Failure invalid={state.status === 'invalid-response'} retry={onRetry} palette={palette} /> : null}
        {loaded ? <>
          {state.status === 'refresh-error' ? <View style={[styles.banner, { borderColor: palette.border, backgroundColor: palette.muted }]}><Text accessibilityRole="alert" allowFontScaling style={[styles.message, { color: palette.foreground }]}>{t('categories.stale')}</Text><Retry onPress={onRetry} palette={palette} /></View> : null}
          {state.categories.length === 0 ? <Text allowFontScaling style={[styles.message, { color: palette.mutedForeground }]}>{t('categories.empty')}</Text> : <View style={styles.categories}>{state.categories.map((category) => <CategoryGroup key={category.id} category={category} palette={palette} onEdit={onEdit} editBlocked={createBlocked} />)}</View>}
        </> : null}
      </View>
    </ScrollView>
  </SafeAreaView>
}

function CategoryGroup({ category, palette, onEdit, editBlocked }: { category: CategoryViewModel; palette: Palette; onEdit: (categoryId: number) => void; editBlocked: boolean }) {
  const { t } = useTranslation()
  return <View style={[styles.card, { borderColor: palette.border, backgroundColor: palette.card }]}>
    <CategoryIdentity category={category} palette={palette} />
    <View style={styles.metaRow}>{category.system ? null : <Text allowFontScaling style={[styles.kind, { color: palette.mutedForeground }]}>{t('categories.customLabel')}</Text>}{!category.system ? <Action label={t('categories.editNamed', { name: category.name })} visibleLabel={t('categories.edit')} onPress={() => onEdit(category.id)} palette={palette} secondary disabled={editBlocked} /> : null}</View>
    {category.children.length ? <View style={[styles.children, { borderTopColor: palette.border }]}>
      <Text accessibilityRole="header" allowFontScaling style={[styles.childrenTitle, { color: palette.mutedForeground }]}>{t('categories.subcategories', { count: category.children.length })}</Text>
      {category.children.map((child) => <View key={child.id} style={styles.child}><CategoryIdentity category={child} palette={palette} compact /><View style={styles.metaRow}>{child.system ? null : <Text allowFontScaling style={[styles.kind, { color: palette.mutedForeground }]}>{t('categories.customLabel')}</Text>}{!child.system ? <Action label={t('categories.editNamed', { name: child.name })} visibleLabel={t('categories.edit')} onPress={() => onEdit(child.id)} palette={palette} secondary disabled={editBlocked} /> : null}</View></View>)}
    </View> : <Text allowFontScaling style={[styles.noChildren, { color: palette.mutedForeground }]}>{t('categories.noSubcategories')}</Text>}
  </View>
}

function CategoryIdentity({ category, palette, compact = false }: { category: CategoryViewModel; palette: Palette; compact?: boolean }) {
  const swatch = category.color ?? palette.primarySoft
  return <View accessible accessibilityLabel={category.name} style={styles.identity}>
    <View style={[styles.glyph, { backgroundColor: swatch, borderColor: palette.border }]}><CategoryIcon icon={category.icon} size={16} color={category.color ? contrastingText(category.color) : palette.foreground} /></View>
    <Text allowFontScaling style={[compact ? styles.childName : styles.name, { color: palette.foreground }]}>{category.name}</Text>
  </View>
}

function contrastingText(color: string) {
  const red = Number.parseInt(color.slice(1, 3), 16)
  const green = Number.parseInt(color.slice(3, 5), 16)
  const blue = Number.parseInt(color.slice(5, 7), 16)
  return (red * 299 + green * 587 + blue * 114) / 1000 > 145
    ? themeTokens.colors.light.foreground
    : themeTokens.colors.dark.foreground
}

function Failure({ invalid, retry, palette }: { invalid: boolean; retry: () => void | Promise<void>; palette: Palette }) { const { t } = useTranslation(); return <View style={[styles.banner, { borderColor: palette.border }]}><Text accessibilityRole="alert" allowFontScaling style={[styles.failureTitle, { color: palette.foreground }]}>{t(invalid ? 'categories.invalidTitle' : 'categories.errorTitle')}</Text><Text allowFontScaling style={[styles.message, { color: palette.mutedForeground }]}>{t(invalid ? 'categories.invalidMessage' : 'categories.errorMessage')}</Text><Retry onPress={retry} palette={palette} /></View> }
function Retry({ onPress, palette }: { onPress: () => void | Promise<void>; palette: Palette }) { const { t } = useTranslation(); return <Pressable accessibilityRole="button" accessibilityLabel={t('common.retry')} onPress={onPress} style={styles.action}><Text allowFontScaling style={[styles.actionText, { color: palette.primary }]}>{t('common.retry')}</Text></Pressable> }
function Action({ label, visibleLabel = label, onPress, palette, secondary = false, disabled = false }: { label: string; visibleLabel?: string; onPress: () => void; palette: Palette; secondary?: boolean; disabled?: boolean }) { return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.button, { borderColor: palette.primary, backgroundColor: secondary ? 'transparent' : palette.primary }, (pressed || disabled) && styles.pressed]}><Text allowFontScaling style={[styles.buttonText, { color: secondary ? palette.primary : palette.background }]}>{visibleLabel}</Text></Pressable> }

const styles = StyleSheet.create({
  safe: { flex: 1 }, content: { flexGrow: 1, padding: themeTokens.layout.screenPadding }, page: { width: '100%', maxWidth: 680, alignSelf: 'center', gap: themeTokens.spacing[6] }, action: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' }, createButton: { alignSelf: 'flex-start' }, actionText: { ...textStyles.action }, heading: { gap: themeTokens.spacing[2] }, titleRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: themeTokens.spacing[4] }, titleCopy: { flex: 1, minWidth: 220, gap: themeTokens.spacing[2] }, title: { ...textStyles.title }, helper: { ...textStyles.body }, message: { ...textStyles.body }, failureTitle: { ...textStyles.section }, banner: { borderWidth: 1, borderRadius: 12, padding: themeTokens.spacing[4], gap: themeTokens.spacing[2] }, categories: { gap: themeTokens.spacing[4] }, card: { borderWidth: 1, borderRadius: 12, padding: themeTokens.spacing[4], gap: themeTokens.spacing[2] }, identity: { flexDirection: 'row', alignItems: 'center', gap: themeTokens.spacing[3] }, glyph: { width: 40, height: 40, borderRadius: 8, borderWidth: 1, alignItems: 'center', justifyContent: 'center' }, glyphText: { ...textStyles.section }, name: { ...textStyles.section, flex: 1 }, childName: { ...textStyles.bodyStrong, flex: 1 }, metaRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: themeTokens.spacing[3] }, kind: { ...textStyles.label, marginLeft: 52, flex: 1 }, children: { borderTopWidth: 1, marginTop: 10, paddingTop: themeTokens.spacing[3], gap: themeTokens.spacing[3] }, childrenTitle: { ...textStyles.meta, fontWeight: '600' as const }, child: { gap: themeTokens.spacing[1] }, noChildren: { ...textStyles.meta, marginTop: 8 }, button: { minHeight: 44, minWidth: 76, borderWidth: 1, borderRadius: 10, paddingHorizontal: themeTokens.spacing[3], alignItems: 'center', justifyContent: 'center' }, buttonText: { ...textStyles.bodyStrong, fontWeight: '600' as const }, pressed: { opacity: 0.55 },
})
