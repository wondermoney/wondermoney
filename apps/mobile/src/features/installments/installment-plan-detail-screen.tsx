import type { Href } from 'expo-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActivityIndicator, Alert, ScrollView, StyleSheet, View } from 'react-native'

import { Amount } from '@/components/ui/amount'
import { BackControl } from '@/components/ui/back-control'
import { Button } from '@/components/ui/button'
import { HeadlineFigure } from '@/components/ui/headline-figure'
import { IconButton } from '@/components/ui/icon-button'
import { List, ListRow } from '@/components/ui/list-row'
import { Notice } from '@/components/ui/notice'
import { ObjectHeader } from '@/components/ui/page-header'
import { SafeAreaView } from '@/components/ui/screen-safe-area'
import { Section } from '@/components/ui/section'
import { OptionSheet, Sheet } from '@/components/ui/sheet'
import { Text } from '@/components/ui/text'
import { useFormatMoney } from '@/lib/formatters/money-display'
import { themeTokens } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'
import { FailureState, LoadingState } from '@/features/accounts/screen-states'

import type { InstallmentDto, InstallmentPlanDetailDto } from './installments-contract'
import { formatPlanDay, InstallmentStatusBadge } from './installment-ui'
import type { InstallmentLinking } from './use-installment-linking'
import type { InstallmentWriteFailure } from './use-installment-plan-mutations'

export type InstallmentPlanDetailViewState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'not-found' }
  | { status: 'invalid-id' }
  | { status: 'invalid-response' }
  | { status: 'access-transition' }
  | { status: 'loaded'; plan: InstallmentPlanDetailDto; stale: boolean }

export type InstallmentPlanDetailScreenProps = Readonly<{
  state: InstallmentPlanDetailViewState
  /** Where "←" returns when there is no history: the card's page. */
  backHref: Href
  onBack?: () => void
  onRetry: () => void | Promise<void>
  onLogout: () => void | Promise<void>
  /** Delete the plan, after the screen's confirmation. Omitted, deleting is not offered. */
  onDelete?: () => void | Promise<void>
  deleting?: boolean
  deleteFailure?: InstallmentWriteFailure | null
  /** Link and unlink installments by hand. Omitted, the rows offer no actions. */
  linking?: InstallmentLinking
}>

/**
 * One installment plan: what the purchase cost, what is paid and what is still to come, then every
 * installment with its scheduled day, the statement it falls on and its status. Upcoming
 * installments are projections: they are not transactions and no balance counts them.
 */
export function InstallmentPlanDetailScreen({ state, backHref, onBack, onRetry, onLogout, onDelete, deleting = false, deleteFailure = null, linking }: InstallmentPlanDetailScreenProps) {
  const { t, i18n } = useTranslation()
  const [menuFor, setMenuFor] = useState<InstallmentDto | null>(null)
  const palette = usePalette()
  const formatMoney = useFormatMoney()
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'
  const back = <BackControl fallback={backHref} onPress={onBack} />

  if (state.status === 'access-transition') return null
  if (state.status === 'loading') return <LoadingState header={<View style={styles.back}>{back}</View>} label={t('installments.detail.loading')} />
  if (state.status !== 'loaded') {
    const key = state.status === 'not-found' ? 'notFound' : state.status === 'invalid-id' ? 'invalidId' : state.status === 'invalid-response' ? 'invalidResponse' : 'error'
    const retryable = state.status === 'error' || state.status === 'invalid-response'
    return (
      <FailureState
        header={<View style={styles.back}>{back}</View>}
        message={t(`installments.detail.${key}.message`)}
        onLogout={onLogout}
        onRetry={retryable ? onRetry : undefined}
        title={t(`installments.detail.${key}.title`)}
      />
    )
  }

  const { plan } = state
  const money = (value: number) => formatMoney(value, { locale, currency: plan.currency })
  const confirmDelete = () => {
    if (!onDelete || deleting) return
    Alert.alert(t('installments.delete.confirmTitle'), t('installments.delete.confirmMessage'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('installments.delete.confirm'), style: 'destructive', onPress: () => { void onDelete() } },
    ])
  }
  const unmatched = plan.unmatchedCount ?? plan.installments.filter((row) => row.status === 'unmatched').length
  const numbersOf = (row: InstallmentDto) => ({ number: row.installmentNumber, total: plan.installmentCount })
  const confirmUnlink = (row: InstallmentDto) => {
    if (!linking || linking.pending) return
    Alert.alert(t('installments.link.unlinkConfirmTitle', numbersOf(row)), t('installments.link.unlinkConfirmMessage'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('installments.link.unlink'), style: 'destructive', onPress: () => { void linking.unlink(row.installmentNumber) } },
    ])
  }
  const onMenu = (action: 'link' | 'unlink') => {
    if (!menuFor || !linking) return
    if (action === 'link') linking.open(menuFor.installmentNumber)
    else confirmUnlink(menuFor)
  }
  const linkTarget = linking?.target == null ? null : plan.installments.find((row) => row.installmentNumber === linking.target) ?? null

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.background }]}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.page}>
          <View style={styles.headerBlock}>
            {back}
            <ObjectHeader
              action={onDelete ? (
                <IconButton accessibilityLabel={t('installments.delete.action')} disabled={deleting} icon="trash" loading={deleting} onPress={confirmDelete} style={styles.overflow} />
              ) : undefined}
              descriptor={t('installments.detail.descriptor', { date: formatPlanDay(plan.purchaseDate, locale), total: plan.installmentCount })}
              title={plan.description}
            />
          </View>

          {deleteFailure ? <Notice message={t(`installments.failures.${deleteFailure}`)} testID="installment-plan-delete-failure" tone="destructive" /> : null}
          {state.stale ? <Notice message={t('installments.detail.stale')} /> : null}
          {linking?.failure && linkTarget === null ? <Notice message={t(linking.failure)} testID="installment-link-failure" tone="destructive" /> : null}

          <View style={styles.lead}>
            <HeadlineFigure
              accessibilityLabel={`${t('installments.remaining')}, ${money(plan.remainingAmount)}`}
              currency={plan.currency}
              label={t('installments.remaining')}
              locale={locale}
              size="md"
              testID="installment-plan-remaining"
              value={plan.remainingAmount}
            />
            <List>
              <ListRow
                figure={<Amount currency={plan.currency} locale={locale} value={plan.totalAmount} />}
                meta={[t('installments.detail.totalMeta', { total: plan.installmentCount })]}
                title={t('installments.total')}
              />
              <ListRow
                accessibilityLabel={`${t('installments.paid')}, ${money(plan.paidAmount)}, ${t('installments.paidCount', { paid: plan.paidCount, total: plan.installmentCount })}`}
                figure={<Amount currency={plan.currency} locale={locale} value={plan.paidAmount} />}
                meta={[t('installments.paidCount', { paid: plan.paidCount, total: plan.installmentCount })]}
                separated
                testID="installment-plan-paid"
                title={t('installments.paid')}
              />
              <ListRow
                accessibilityLabel={`${t('installments.remaining')}, ${money(plan.remainingAmount)}, ${t('installments.remainingCount', { count: plan.remainingCount })}`}
                figure={<Amount currency={plan.currency} locale={locale} value={plan.remainingAmount} />}
                meta={[t('installments.remainingCount', { count: plan.remainingCount }), unmatched > 0 ? t('installments.unmatchedCount', { count: unmatched }) : null]}
                separated
                testID="installment-plan-remaining-row"
                title={t('installments.remaining')}
              />
            </List>
          </View>

          <Section title={t('installments.detail.scheduleTitle')} variant="open" testID="installment-plan-schedule">
            <List divided>
              {plan.installments.map((row) => (
                <InstallmentRow
                  currency={plan.currency}
                  count={plan.installmentCount}
                  key={row.installmentNumber}
                  locale={locale}
                  onMore={linking && row.status ? () => setMenuFor(row) : undefined}
                  row={row}
                />
              ))}
            </List>
            <Text tone="muted" variant="label">{t('installments.projectionNote')}</Text>
          </Section>
        </View>
      </ScrollView>
      {linking ? (
        <OptionSheet
          mode="menu"
          onClose={() => setMenuFor(null)}
          onSelect={onMenu}
          options={menuFor?.status === 'paid'
            ? [{ value: 'unlink', label: t('installments.link.unlink'), destructive: true }]
            : [{ value: 'link', label: t('installments.link.action') }]}
          testID="installment-row-menu"
          title={menuFor ? t('installments.badgeLabel', numbersOf(menuFor)) : ''}
          visible={menuFor !== null}
        />
      ) : null}
      {linking && linkTarget ? (
        <InstallmentLinkSheet currency={plan.currency} installment={linkTarget} installmentCount={plan.installmentCount} linking={linking} locale={locale} />
      ) : null}
    </SafeAreaView>
  )
}

/**
 * The candidate list for one installment: the card's posted charges near its day, closest amount
 * first, each with by how much it differs. Choosing one and "Link" links it.
 */
function InstallmentLinkSheet({ installment, installmentCount, currency, locale, linking }: {
  installment: InstallmentDto
  installmentCount: number
  currency: string
  locale: string
  linking: InstallmentLinking
}) {
  const { t } = useTranslation()
  const palette = usePalette()
  const formatMoney = useFormatMoney()
  const [chosen, setChosen] = useState<number | null>(null)
  const money = (value: number) => formatMoney(value, { locale, currency })
  const rows = linking.candidates.status === 'loaded' ? linking.candidates.rows : []
  const chosenKey = rows.some((row) => row.transactionKey === chosen) ? chosen : null
  const helper = t(linking.showAllAmounts ? 'installments.link.helperAll' : 'installments.link.helper', {
    date: formatPlanDay(installment.scheduledDate, locale),
    amount: money(installment.amount),
  })

  return (
    <Sheet
      closeLabel={t('common.close')}
      footer={(
        <Button
          block
          disabled={chosenKey === null}
          label={t('installments.link.confirm')}
          loading={linking.pending}
          onPress={() => { if (chosenKey !== null) void linking.link(chosenKey) }}
        />
      )}
      onClose={linking.close}
      testID="installment-link-sheet"
      title={t('installments.link.title', { number: installment.installmentNumber, total: installmentCount })}
      visible
    >
      <View style={styles.sheetBody}>
        <Text tone="muted" variant="meta">{helper}</Text>
        {linking.candidates.status === 'loading' ? (
          <View accessibilityLabel={t('installments.link.searching')} accessible style={styles.searching}>
            <ActivityIndicator color={palette.mutedForeground} />
            <Text tone="muted" variant="meta">{t('installments.link.searching')}</Text>
          </View>
        ) : linking.candidates.status === 'error' ? (
          <Notice message={t('installments.link.loadFailed')} tone="destructive" />
        ) : rows.length === 0 ? (
          <View style={styles.empty} testID="installment-link-empty">
            <Text variant="meta">{t('installments.link.empty')}</Text>
            {linking.showAllAmounts ? null : <Text tone="muted" variant="meta">{t('installments.link.emptyHint')}</Text>}
          </View>
        ) : (
          <List divided>
            {rows.map((row) => {
              const date = formatPlanDay(row.day, locale)
              const difference = row.amountDifference === 0
                ? null
                : t(row.amountDifference > 0 ? 'installments.link.more' : 'installments.link.less', { amount: money(Math.abs(row.amountDifference)) })
              return (
                <ListRow
                  accessibilityLabel={[row.title, money(row.amount), date, difference].filter(Boolean).join(', ')}
                  figure={<Amount currency={currency} locale={locale} value={row.amount} />}
                  key={row.transactionKey}
                  meta={[date, difference]}
                  onPress={() => setChosen(row.transactionKey)}
                  selected={row.transactionKey === chosenKey}
                  testID={`installment-candidate-${row.transactionKey}`}
                  title={row.title}
                />
              )
            })}
          </List>
        )}
        <View style={styles.toggle}>
          <Button
            label={t(linking.showAllAmounts ? 'installments.link.showClose' : 'installments.link.showOther')}
            onPress={linking.toggleShowAllAmounts}
            size="sm"
            variant="ghost"
          />
        </View>
        {linking.failure ? <Notice message={t(linking.failure)} testID="installment-link-failure" tone="destructive" /> : null}
      </View>
    </Sheet>
  )
}

function InstallmentRow({ row, count, currency, locale, onMore }: { row: InstallmentDto; count: number; currency: string; locale: string; onMore?: () => void }) {
  const { t } = useTranslation()
  const formatMoney = useFormatMoney()
  const title = t('installments.badgeLabel', { number: row.installmentNumber, total: count })
  const scheduled = t('installments.detail.scheduled', { date: formatPlanDay(row.scheduledDate, locale) })
  const due = row.dueDate ? t('installments.detail.statementDue', { date: formatPlanDay(row.dueDate, locale) }) : null
  const posted = row.status === 'paid' && row.postedDate ? t('installments.detail.posted', { date: formatPlanDay(row.postedDate, locale) }) : null
  const status = row.status ? t(`installments.status.${row.status}`) : null
  // A paid row shows what the bank charged; a projection what the plan expects.
  const shown = row.status === 'paid' && row.postedAmount != null ? row.postedAmount : row.amount
  return (
    <ListRow
      accessibilityLabel={[title, formatMoney(shown, { locale, currency }), scheduled, due, posted, status].filter(Boolean).join(', ')}
      badge={<InstallmentStatusBadge status={row.status} testID={`installment-status-${row.installmentNumber}`} />}
      figure={<Amount currency={currency} locale={locale} value={shown} />}
      meta={[posted ?? scheduled, due]}
      moreAccessibilityLabel={t('installments.link.actionsLabel', { number: row.installmentNumber, total: count })}
      onMorePress={onMore}
      testID={`installment-row-${row.installmentNumber}`}
      title={title}
    />
  )
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: { flexGrow: 1, padding: themeTokens.layout.screenPadding, paddingBottom: themeTokens.spacing[12] },
  page: { width: '100%', maxWidth: 760, alignSelf: 'center', gap: themeTokens.spacing[10] },
  back: { alignItems: 'flex-start' },
  headerBlock: { gap: themeTokens.spacing[4] },
  overflow: { marginRight: -11, marginVertical: -6 },
  lead: { gap: themeTokens.spacing[6] },
  sheetBody: { gap: themeTokens.spacing[4] },
  searching: { flexDirection: 'row', alignItems: 'center', gap: themeTokens.spacing[2] },
  empty: { gap: themeTokens.spacing[1] },
  toggle: { alignItems: 'flex-start' },
})
