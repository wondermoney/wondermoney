import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { View } from 'react-native'

import { Amount } from '@/components/ui/amount'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { List, ListRow } from '@/components/ui/list-row'
import { Notice } from '@/components/ui/notice'
import { Section } from '@/components/ui/section'
import { Text } from '@/components/ui/text'
import { useFormatMoney } from '@/lib/formatters/money-display'
import { themeTokens } from '@/theme/tokens'

import type { CreditCardStatementDto } from './accounts-contract'
import { useCreditCardStatementDetail } from './use-credit-card-statement-detail'

export type CreditCardStatementState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'invalid-response' }
  | { status: 'empty' }
  | { status: 'loaded'; statement: CreditCardStatementDto; statements: CreditCardStatementDto[]; creditLimit: number | null }

function formatStatementDate(value: string, locale: string): string {
  // The API sends a calendar day; noon UTC keeps it on the same day in every timezone.
  const date = new Date(`${value}T12:00:00.000Z`)
  if (!Number.isFinite(date.getTime())) return value
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(date)
}

/**
 * The current credit-card statement on an account's page: what it charges, when it is due and how
 * much of the limit is still free. Only rendered for an account that is a card.
 */
export function CreditCardStatementSection({ state, currency, locale, accountId }: { state: CreditCardStatementState; currency: string; locale: string; accountId: number }) {
  const { t } = useTranslation()
  const formatMoney = useFormatMoney()
  const [selectedEnd, setSelectedEnd] = useState<string | null>(null)
  const selected = state.status === 'loaded'
    ? state.statements.find((statement) => statement.periodEnd === selectedEnd)
      ?? state.statements.find((statement) => statement.isCurrent)
      ?? state.statements.at(-1)
      ?? null
    : null
  const detail = useCreditCardStatementDetail(accountId, selected?.periodEnd ?? null)
  const sortedStatements = useMemo(
    () => state.status === 'loaded' ? [...state.statements].reverse() : [],
    [state],
  )

  let body: React.ReactNode
  if (state.status === 'loading') {
    body = <Text tone="muted" variant="meta">{t('creditCardStatement.loading')}</Text>
  } else if (state.status === 'invalid-response') {
    body = <Notice message={t('creditCardStatement.invalidResponse')} />
  } else if (state.status === 'error') {
    body = <Notice message={t('creditCardStatement.error')} />
  } else if (state.status === 'empty') {
    body = <Text tone="muted" variant="meta">{t('creditCardStatement.empty')}</Text>
  } else {
    const { statement, creditLimit } = state
    body = (
      <>
        <List>
          <ListRow
            figure={<Amount currency={currency} locale={locale} value={statement.balance} />}
            meta={[t('creditCardStatement.period', {
              start: formatStatementDate(statement.periodStart, locale),
              end: formatStatementDate(statement.periodEnd, locale),
            })]}
            title={t('creditCardStatement.balance')}
          />
          <ListRow
            figure={<Text variant="bodyStrong">{formatStatementDate(statement.dueDate, locale)}</Text>}
            meta={[t('creditCardStatement.dueHelper')]}
            separated
            title={t('creditCardStatement.dueDate')}
          />
          <ListRow
            figure={<Amount currency={currency} locale={locale} value={statement.availableCredit} />}
            meta={[creditLimit === null
              ? t('creditCardStatement.limitNotSet')
              : t('creditCardStatement.limitOf', { limit: formatMoney(creditLimit, { locale, currency }) })]}
            separated
            title={t('creditCardStatement.availableCredit')}
          />
        </List>
        <Section title={t('creditCardStatement.historyTitle')} variant="open" testID="credit-card-statement-history">
          {sortedStatements.length === 0 ? (
            <Text tone="muted" variant="meta">{t('creditCardStatement.empty')}</Text>
          ) : (
            <List divided>
              {sortedStatements.map((row) => (
                <ListRow
                  key={row.periodEnd}
                  accessibilityLabel={t('creditCardStatement.historyRow', {
                    start: formatStatementDate(row.periodStart, locale),
                    end: formatStatementDate(row.periodEnd, locale),
                    balance: formatMoney(row.balance, { locale, currency }),
                    status: t(`creditCardStatement.status.${row.status}`),
                  })}
                  badge={<Badge label={t(`creditCardStatement.status.${row.status}`)} tone={row.status === 'overdue' ? 'destructive' : row.status === 'paid' ? 'success' : row.status === 'closed' ? 'info' : 'neutral'} />}
                  figure={<Amount currency={currency} locale={locale} value={row.balance} />}
                  meta={[t('creditCardStatement.historyDue', { date: formatStatementDate(row.dueDate, locale) })]}
                  onPress={() => setSelectedEnd(row.periodEnd)}
                  selected={row.periodEnd === selected?.periodEnd}
                  testID={`credit-card-statement-row-${row.periodEnd}`}
                  title={t('creditCardStatement.period', { start: formatStatementDate(row.periodStart, locale), end: formatStatementDate(row.periodEnd, locale) })}
                />
              ))}
            </List>
          )}
          {selected ? <StatementTransactions currency={currency} detail={detail} locale={locale} /> : null}
        </Section>
      </>
    )
  }

  return (
    <Section title={t('creditCardStatement.title')} variant="open" testID="credit-card-statement">
      {body}
    </Section>
  )
}

function StatementTransactions({ currency, detail, locale }: { currency: string; detail: ReturnType<typeof useCreditCardStatementDetail>; locale: string }) {
  const { t } = useTranslation()
  if (detail.isLoading) return <Text accessibilityRole="alert" tone="muted" variant="meta">{t('creditCardStatement.transactionsLoading')}</Text>
  if (detail.error) return <Notice action={<Button label={t('common.retry')} onPress={() => { void detail.refetch() }} size="sm" variant="outline" />} message={t(detail.error instanceof Error && 'code' in detail.error && detail.error.code === 'invalid-response' ? 'creditCardStatement.transactionsInvalid' : 'creditCardStatement.transactionsError')} />
  const transactions = detail.data?.statement.transactions
  if (!transactions) return null
  if (transactions.length === 0) return <Text tone="muted" variant="meta">{t('creditCardStatement.transactionsEmpty')}</Text>
  return (
    <View style={{ paddingTop: themeTokens.spacing[3] }} testID="credit-card-statement-transactions">
      <Text accessibilityRole="header" variant="metaStrong">{t('creditCardStatement.transactionsTitle')}</Text>
      <List>
        {transactions.map((transaction, index) => (
          <ListRow
            key={transaction.transactionKey}
            figure={<Amount currency={currency} locale={locale} value={transaction.amount} />}
            meta={[transaction.transactionDate ? formatStatementDate(transaction.transactionDate, locale) : null]}
            separated={index > 0}
            title={transaction.merchantName ?? transaction.description ?? t('creditCardStatement.transactionUnavailable')}
          />
        ))}
      </List>
    </View>
  )
}
