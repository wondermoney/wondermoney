import { useTranslation } from 'react-i18next'

import { Amount } from '@/components/ui/amount'
import { List, ListRow } from '@/components/ui/list-row'
import { Notice } from '@/components/ui/notice'
import { Section } from '@/components/ui/section'
import { Text } from '@/components/ui/text'
import { useFormatMoney } from '@/lib/formatters/money-display'

import type { CreditCardStatementDto } from './accounts-contract'

export type CreditCardStatementState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'invalid-response' }
  | { status: 'empty' }
  | { status: 'loaded'; statement: CreditCardStatementDto; creditLimit: number | null }

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
export function CreditCardStatementSection({ state, currency, locale }: { state: CreditCardStatementState; currency: string; locale: string }) {
  const { t } = useTranslation()
  const formatMoney = useFormatMoney()

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
    )
  }

  return (
    <Section title={t('creditCardStatement.title')} variant="open" testID="credit-card-statement">
      {body}
    </Section>
  )
}
