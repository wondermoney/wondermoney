import { useTranslation } from 'react-i18next'
import { RefreshControl, StyleSheet, Switch, View } from 'react-native'

import { Button } from '@/components/ui/button'
import { EntityMark } from '@/components/ui/entity-mark'
import { FloatingActionButton } from '@/components/ui/floating-action-button'
import { Icon } from '@/components/ui/icon'
import { ListRow } from '@/components/ui/list-row'
import { Text } from '@/components/ui/text'
import { SettingsGroup, SettingsLoading, SettingsNotice, SettingsPage, SettingsSection } from '@/features/more/settings-ui'
import { themeTokens } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'

import type { CategoryViewModel } from './categories-view-model'

export type CategoriesViewState =
  | { status: 'loading' | 'error' | 'invalid-response' | 'access-transition' }
  | { status: 'loaded' | 'refresh-error'; categories: readonly CategoryViewModel[]; refreshing?: boolean }

/**
 * Settings › Categories (web `components/settings/Categories.tsx`): the section head,
 * then each parent category as one group of rows with its subcategories indented
 * beneath. Web adds a category in a form below the table; mobile opens its own create
 * screen from the floating "+".
 */
export function CategoriesScreen({ state, createBlocked = false, demoLocked = false, togglePending = false, onBack, onRetry, onCreate = () => undefined, onEdit = () => undefined, onToggleCountsAsSpending = () => undefined }: { state: CategoriesViewState; createBlocked?: boolean; demoLocked?: boolean; togglePending?: boolean; onBack: () => void; onRetry: () => void | Promise<void>; onCreate?: () => void; onEdit?: (categoryId: number) => void; onToggleCountsAsSpending?: (categoryId: number, countsAsSpending: boolean) => void }) {
  const { t } = useTranslation()
  const palette = usePalette()
  if (state.status === 'access-transition') return null
  const loaded = state.status === 'loaded' || state.status === 'refresh-error'
  return (
    <SettingsPage
      backLabel={t('categories.back')}
      onBack={onBack}
      refreshControl={loaded ? <RefreshControl refreshing={Boolean(state.refreshing)} onRefresh={onRetry} tintColor={palette.primary} /> : undefined}
      section="categories"
      floatingAction={<FloatingActionButton accessibilityLabel={t('categories.create')} disabled={createBlocked || !loaded} onPress={onCreate} testID="categories-create" />}
    >
      <SettingsSection first title={t('categories.title')} description={t('settings.categories.description')}>
        {createBlocked ? <Text accessibilityRole="alert" tone="muted" variant="meta">{t(demoLocked ? 'categories.demoWriteBlocked' : 'categories.writeBlocked')}</Text> : null}
        {state.status === 'loading' ? <SettingsLoading label={t('categories.loading')} /> : null}
        {state.status === 'error' || state.status === 'invalid-response' ? (
          <SettingsNotice
            action={<Button label={t('common.retry')} onPress={() => void onRetry()} size="sm" variant="outline" />}
            alert
            message={t(state.status === 'invalid-response' ? 'categories.invalidMessage' : 'categories.errorMessage')}
            title={t(state.status === 'invalid-response' ? 'categories.invalidTitle' : 'categories.errorTitle')}
          />
        ) : null}
        {loaded ? <>
          {state.status === 'refresh-error' ? (
            <SettingsNotice
              action={<Button label={t('common.retry')} onPress={() => void onRetry()} size="sm" variant="outline" />}
              alert
              message={t('categories.stale')}
            />
          ) : null}
          {state.categories.length === 0
            ? <Text tone="muted" variant="meta">{t('categories.empty')}</Text>
            : (
              <View style={styles.groups}>
                {state.categories.map((category) => (
                  <CategoryGroup key={category.id} category={category} onEdit={onEdit} onToggle={onToggleCountsAsSpending} editBlocked={createBlocked} toggleBlocked={createBlocked || togglePending} />
                ))}
              </View>
            )}
        </> : null}
      </SettingsSection>
    </SettingsPage>
  )
}

/** A parent category and its subcategories as one group of rows, the children indented beneath it. */
function CategoryGroup({ category, onEdit, onToggle, editBlocked, toggleBlocked }: { category: CategoryViewModel; onEdit: (categoryId: number) => void; onToggle: (categoryId: number, countsAsSpending: boolean) => void; editBlocked: boolean; toggleBlocked: boolean }) {
  const { t } = useTranslation()
  const count = category.children.length
  return (
    <SettingsGroup>
      <CategoryRow
        category={category}
        meta={count ? t('categories.subcategories', { count }) : t('categories.noSubcategories')}
        onEdit={onEdit}
        onToggle={onToggle}
        editBlocked={editBlocked}
        toggleBlocked={toggleBlocked}
      />
      {category.children.map((child) => <CategoryRow key={child.id} category={child} onEdit={onEdit} onToggle={onToggle} editBlocked={editBlocked} toggleBlocked={toggleBlocked} child />)}
    </SettingsGroup>
  )
}

/**
 * One category: its mark, the name (16/500 for a parent, 16 for a child) and a muted
 * line. A custom category's row opens its edit screen. A system one can't be edited, but
 * carries its "Counts as spending" switch: the choice is this household's only, and it is
 * locked off under a main category that doesn't count.
 */
function CategoryRow({ category, meta, onEdit, onToggle, editBlocked, toggleBlocked, child = false }: { category: CategoryViewModel; meta?: string; onEdit: (categoryId: number) => void; onToggle: (categoryId: number, countsAsSpending: boolean) => void; editBlocked: boolean; toggleBlocked: boolean; child?: boolean }) {
  const { t } = useTranslation()
  const palette = usePalette()
  const lines = [category.system ? null : t('categories.customLabel'), category.countsAsSpending ? null : t('categories.notSpending'), meta].filter((line): line is string => Boolean(line))
  const editable = !category.system
  const spendingSwitch = (
    <Switch
      accessibilityHint={category.lockedByParent === true ? t('categoryManage.countsAsSpendingParentOff') : undefined}
      accessibilityLabel={t('categories.countsAsSpendingNamed', { name: category.name })}
      accessibilityRole="switch"
      accessibilityState={{ checked: category.countsAsSpending, disabled: category.lockedByParent === true || toggleBlocked }}
      disabled={category.lockedByParent === true || toggleBlocked}
      onValueChange={(next) => onToggle(category.id, next)}
      testID={`category-counts-as-spending-${category.id}`}
      trackColor={{ false: palette.muted, true: palette.primary }}
      value={category.countsAsSpending}
    />
  )
  return (
    <View style={child ? styles.childRow : styles.row}>
      <ListRow
        accessibilityLabel={editable ? t('categories.editNamed', { name: category.name }) : [category.name, ...lines].join(', ')}
        density="comfortable"
        figure={editable ? (editBlocked ? undefined : <Icon color={palette.mutedForeground} name="chevron-right" size={themeTokens.size.iconSmall} />) : spendingSwitch}
        leading={<EntityMark icon={{ name: category.icon, bgColor: category.color }} size={child ? 'sm' : 'md'} />}
        meta={lines}
        onPress={editable && !editBlocked ? () => onEdit(category.id) : undefined}
        title={category.name}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  groups: { gap: themeTokens.spacing[3] },
  row: { paddingHorizontal: themeTokens.spacing[4] },
  // Subcategories indent past the parent's mark so the hierarchy reads at a glance.
  childRow: { paddingLeft: themeTokens.spacing[4] + themeTokens.mark.md + themeTokens.spacing[3], paddingRight: themeTokens.spacing[4] },
})
