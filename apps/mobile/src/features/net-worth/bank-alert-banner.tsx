import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import { StyleSheet, View } from 'react-native'

import { Button } from '@/components/ui/button'
import { Notice } from '@/components/ui/notice'
import type { BankAlertDto } from '@/features/banking/bank-alerts-contract'
import type { BankAlertBannerModel } from '@/features/banking/bank-alerts-view-model'
import { themeTokens } from '@/theme/tokens'

import { formatShortDate } from './home-model'

/** The bank connections screen, which offers Reconnect per bank. */
export const BANK_CONNECTIONS_HREF = '/more/banking'

/** The headline for one alert: the bank, then what happened to its access. */
export function bankAlertHeadline(alert: BankAlertDto, t: TFunction, locale: string): string {
  const bank = alert.institutionName?.trim() || t('home.bankAlerts.unnamedBank')
  switch (alert.kind) {
    case 'consent_expiring':
      return alert.daysUntilExpiry === null
        ? t('home.bankAlerts.expiringSoon', { bank })
        : t('home.bankAlerts.expiring', { bank, count: alert.daysUntilExpiry })
    case 'consent_revoked':
      return t('home.bankAlerts.revoked', { bank })
    case 'sync_failing': {
      const since = alert.failingSince ? new Date(alert.failingSince) : null
      return since && !Number.isNaN(since.getTime())
        ? t('home.bankAlerts.failing', { bank, date: formatShortDate(since, locale) })
        : t('home.bankAlerts.failingUnknownDate', { bank })
    }
  }
}

/**
 * One compact banner for every bank alert not yet dismissed: the most urgent
 * alert's headline and fix, "and N more" when there are others, a Reconnect
 * that opens the bank connections screen, and a dismiss for all of them.
 */
export function BankAlertBanner({ model, locale, onNavigate, onDismiss }: {
  model: BankAlertBannerModel
  locale: string
  onNavigate: (href: string) => void
  onDismiss: () => void
}) {
  const { t } = useTranslation()
  const hint = t(`home.bankAlerts.hint.${model.primary.kind}`)
  const more = model.moreCount > 0 ? t('home.bankAlerts.more', { count: model.moreCount }) : null
  return (
    <Notice
      action={(
        <View style={styles.actions}>
          <Button label={t('home.bankAlerts.reconnect')} onPress={() => onNavigate(BANK_CONNECTIONS_HREF)} size="sm" variant="outline" />
          <Button label={t('home.bankAlerts.dismiss')} onPress={onDismiss} size="sm" variant="ghost" />
        </View>
      )}
      message={more ? `${hint} ${more}` : hint}
      testID="home-bank-alert"
      title={bankAlertHeadline(model.primary, t, locale)}
      tone="warning"
    />
  )
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: themeTokens.spacing[2] },
})
