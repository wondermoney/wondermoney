import { useTranslation } from 'react-i18next'
import { StyleSheet, View } from 'react-native'

import { Amount } from '@/components/ui/amount'
import { Card } from '@/components/ui/card'
import { List, ListRow } from '@/components/ui/list-row'
import { Divider } from '@/components/ui/section'
import { Text } from '@/components/ui/text'
import { formatTransactionDate } from '@/lib/dates/transaction-date'
import { themeTokens } from '@/theme/tokens'
import { InstallmentBadge } from '@/features/installments/installment-badge'

import type { AccountForecastDto } from './forecast-contract'
import { SectionMessage } from './screen-states'

export type AccountForecastState =
  | { status: 'error' }
  | { status: 'loading' }
  | { status: 'unavailable' }
  | { series: AccountForecastDto; status: 'loaded' }

/**
 * The account's projected low point and the recurring payments still to come.
 *
 * A projection, so it is stated as one: the card names the window, the day the
 * lowest balance is expected and the figure in the account's own currency. The
 * rows are not transactions and are not counted in any total.
 */
export function ForecastCard({ days, locale, state }: { days: number; locale: string; state: AccountForecastState }) {
  const { t } = useTranslation()

  if (state.status === 'loading') {
    return (
      <Card testID="account-forecast">
        <SectionMessage loading />
      </Card>
    )
  }
  if (state.status === 'error') {
    return (
      <Card testID="account-forecast">
        <Text tone="muted" variant="meta">{t('accountsOverview.sectionUnavailable')}</Text>
      </Card>
    )
  }
  if (state.status === 'unavailable') {
    return (
      <Card testID="account-forecast">
        <Text tone="muted" variant="meta">{t('accountForecast.unavailable')}</Text>
      </Card>
    )
  }

  const { series } = state
  const installments = series.projectedInstallments ?? []
  if (!series.lowPoint || series.openingBalance === null) {
    return (
      <Card testID="account-forecast">
        <Text tone="muted" variant="meta">{t('accountForecast.unavailable')}</Text>
      </Card>
    )
  }

  return (
    <Card testID="account-forecast">
      <Text tone="muted" variant="label">{t('accountForecast.lowPoint', { days })}</Text>
      <View style={styles.figureRow}>
        <Amount currency={series.currency} locale={locale} size="stat" value={series.lowPoint.balance} />
        <Text tone="muted" variant="meta">{formatTransactionDate(`${series.lowPoint.date}T00:00:00.000Z`, locale)}</Text>
      </View>
      {installments.length > 0 ? (
        <>
          <Divider />
          <Text variant="metaStrong">{t('accountForecast.nextInstallments')}</Text>
          <List>
            {installments.slice(0, 3).map((item, index) => (
              <ListRow
                key={`${item.installmentPlanKey}-${item.installmentNumber}`}
                badge={<InstallmentBadge installment={item} testID={`forecast-installment-${item.installmentPlanKey}-${item.installmentNumber}`} />}
                figure={<Amount currency={item.currency} locale={locale} size="amount" value={-item.amount} />}
                meta={[formatTransactionDate(`${item.date}T00:00:00.000Z`, locale)]}
                separated={index > 0}
                title={item.name}
              />
            ))}
          </List>
        </>
      ) : null}
      {series.projected.length > 0 ? (
        <>
          <Divider />
          <Text variant="metaStrong">{t('accountForecast.next')}</Text>
          <List>
            {series.projected.slice(0, 3).map((item, index) => (
              <ListRow
                key={`${item.seriesKey}-${item.date}`}
                figure={<Amount currency={item.currency} locale={locale} size="amount" value={-item.amount} />}
                meta={[formatTransactionDate(`${item.date}T00:00:00.000Z`, locale)]}
                separated={index > 0}
                title={item.name}
              />
            ))}
          </List>
        </>
      ) : null}
      {series.projected.length > 0 || installments.length > 0 ? (
        <Text tone="muted" variant="label">{t('accountForecast.notCounted')}</Text>
      ) : null}
    </Card>
  )
}

const styles = StyleSheet.create({
  figureRow: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', gap: themeTokens.spacing[2] },
})
