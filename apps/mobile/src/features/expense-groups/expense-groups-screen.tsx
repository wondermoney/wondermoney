import { useTranslation } from 'react-i18next'
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EntityMark } from '@/components/ui/entity-mark'
import { FLOATING_ACTION_SIZE, FloatingActionButton } from '@/components/ui/floating-action-button'
import { List, ListGroupHeading, ListRow } from '@/components/ui/list-row'
import { PageHeader } from '@/components/ui/page-header'
import { SafeAreaView } from '@/components/ui/screen-safe-area'
import { Text } from '@/components/ui/text'
import { Alert, Failure, Loading } from '@/features/loans/loans-screen'
import { useFormatMoney } from '@/lib/formatters/money-display'
import { themeTokens } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'

import type { ExpenseGroupDto } from './expense-groups-contract'
import { yourBalances } from './expense-groups-view-model'

export type ExpenseGroupsViewState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'loaded' | 'refresh-error'; groups: readonly ExpenseGroupDto[]; refreshing?: boolean }

/**
 * Groups, from the More tab: each group with how many people are in it and where the reader
 * stands in it, per currency ("You are owed €40.00", "You owe $12.50", "Settled up"). Archived
 * groups follow under their own heading. "New group" is the floating "+", hidden from viewers.
 */
export function ExpenseGroupsScreen({ state, canWrite, onRefresh, onOpenGroup, onCreateGroup }: Readonly<{
  state: ExpenseGroupsViewState
  canWrite: boolean
  onRefresh: () => void | Promise<void>
  onOpenGroup: (groupId: number) => void
  onCreateGroup: () => void
}>) {
  const { t, i18n } = useTranslation()
  const palette = usePalette()
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'
  if (state.status === 'loading') return <Loading label={t('expenseGroups.loading')} />
  if (state.status === 'error') return <Failure message={t('expenseGroups.errorMessage')} onRetry={onRefresh} title={t('expenseGroups.errorTitle')} />
  const active = state.groups.filter((group) => !group.archived)
  const archived = state.groups.filter((group) => group.archived)
  const empty = state.groups.length === 0
  return (
    <View style={styles.safe}>
      <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]}>
        <ScrollView
          contentContainerStyle={[styles.content, canWrite && !empty && styles.underButton]}
          refreshControl={<RefreshControl onRefresh={() => void onRefresh()} refreshing={Boolean(state.refreshing)} tintColor={palette.primary} />}
        >
          <View style={styles.page}>
            {state.status === 'refresh-error' ? <Alert label={t('expenseGroups.stale')} /> : null}
            <PageHeader description={t('expenseGroups.description')} title={t('expenseGroups.title')} />
            {empty ? (
              <View style={styles.empty}>
                <Text accessibilityRole="header" variant="section">{t('expenseGroups.emptyTitle')}</Text>
                <Text tone="muted" variant="meta">{t('expenseGroups.emptyMessage')}</Text>
                {canWrite ? <Button icon="plus" label={t('expenseGroups.new')} onPress={onCreateGroup} style={styles.hug} /> : null}
              </View>
            ) : (
              <View>
                <List>
                  {active.map((group, index) => <GroupRow group={group} key={group.expenseGroupKey} locale={locale} onPress={() => onOpenGroup(group.expenseGroupKey)} separated={index > 0} />)}
                </List>
                {archived.length > 0 ? (
                  <>
                    <ListGroupHeading first={active.length === 0} title={t('expenseGroups.archivedSection')} variant="heading" />
                    <List>
                      {archived.map((group, index) => <GroupRow group={group} key={group.expenseGroupKey} locale={locale} onPress={() => onOpenGroup(group.expenseGroupKey)} separated={index > 0} />)}
                    </List>
                  </>
                ) : null}
              </View>
            )}
          </View>
        </ScrollView>
      </SafeAreaView>
      {canWrite && !empty ? <FloatingActionButton accessibilityLabel={t('expenseGroups.new')} onPress={onCreateGroup} testID="expense-groups-new" /> : null}
    </View>
  )
}

function GroupRow({ group, locale, onPress, separated }: Readonly<{ group: ExpenseGroupDto; locale: string; onPress: () => void; separated: boolean }>) {
  const { t } = useTranslation()
  const formatMoney = useFormatMoney()
  const standing = yourBalances(group).map((entry) => t(entry.standing === 'owed' ? 'expenseGroups.youAreOwed' : 'expenseGroups.youOwe', { amount: formatMoney(entry.amount, { locale, currency: entry.currencyCode }) }))
  const inGroup = group.members.some((member) => member.isYou)
  const balanceLines = standing.length > 0 ? standing : [inGroup ? t('expenseGroups.settledUp') : t('expenseGroups.notInGroup')]
  const people = t('expenseGroups.people', { count: group.members.length })
  return (
    <ListRow
      accessibilityLabel={[group.name, group.archived ? t('expenseGroups.archived') : null, people, ...balanceLines].filter(Boolean).join(', ')}
      badge={group.archived ? <Badge label={t('expenseGroups.archived')} tone="muted" /> : undefined}
      density="comfortable"
      leading={<EntityMark glyph="users" />}
      meta={[people, ...balanceLines]}
      onPress={onPress}
      separated={separated}
      testID={`expense-group-${group.expenseGroupKey}`}
      title={group.name}
    />
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { flexGrow: 1, padding: themeTokens.layout.screenPadding, paddingBottom: themeTokens.spacing[12] },
  underButton: { paddingBottom: FLOATING_ACTION_SIZE + themeTokens.spacing[8] },
  page: { width: '100%', maxWidth: 760, alignSelf: 'center', gap: themeTokens.spacing[8] },
  empty: { gap: themeTokens.spacing[3] },
  hug: { alignSelf: 'flex-start' },
})
