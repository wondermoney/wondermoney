import { useTranslation } from 'react-i18next'
import { Pressable, StyleSheet, View } from 'react-native'

import { Amount } from '@/components/ui/amount'
import { Text } from '@/components/ui/text'
import { themeTokens } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'

import type { TransactionsLeadData } from './use-transactions-lead'

/**
 * Web's `TransactionsLead`, compacted for a phone: Money in, Money out and
 * Transactions in view on one row at amountBase, then "7 need review · Review
 * them" on one line when anything does. The money columns get the extra width
 * so a six-figure sum still fits on its line.
 */
export function TransactionsLead({
  data,
  viewTotal,
  currency,
  locale,
  onReview,
  reviewDisabled = false,
}: {
  data: TransactionsLeadData
  viewTotal: number | null
  currency: string | null
  locale: string
  onReview: () => void
  reviewDisabled?: boolean
}) {
  const { t } = useTranslation()
  const flows = data.flows
  const review = data.reviewCount
  const reviewCount = review.status === 'loaded' ? review.value : 0
  return (
    <View style={styles.lead} testID="transactions-lead">
      <View style={styles.row}>
        <Column label={t('transactions.moneyIn')} weight={MONEY}>
          {flows.status === 'loading' ? <Skeleton /> : (
            <SignedAmount currency={currency} locale={locale} value={flows.status === 'loaded' ? flows.value.moneyIn : null} />
          )}
        </Column>
        <Column label={t('transactions.moneyOut')} weight={MONEY}>
          {flows.status === 'loading' ? <Skeleton /> : (
            <Amount currency={currency} locale={locale} size="amountBase" value={flows.status === 'loaded' ? -flows.value.moneyOut : null} />
          )}
        </Column>
        <Column label={t('transactions.inView')} weight={1}>
          <Text variant="amountBase">{viewTotal === null ? '—' : String(viewTotal)}</Text>
        </Column>
      </View>
      {reviewCount > 0 ? (
        <View style={styles.review}>
          <Text tone="warning" variant="metaStrong">{t('transactions.needReviewCount', { count: reviewCount })}</Text>
          <Pressable
            accessibilityLabel={t('transactions.reviewLink')}
            accessibilityRole="button"
            accessibilityState={{ disabled: reviewDisabled }}
            disabled={reviewDisabled}
            hitSlop={12}
            onPress={onReview}
            style={({ pressed }) => [reviewDisabled && styles.disabled, pressed && styles.pressed]}
          >
            <Text tone="primary" variant="metaStrong">{t('transactions.reviewLink')}</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  )
}

const MONEY = 1.3

/** Money in reads "+€8,724.00", as web's signed stat does, without colouring it. */
function SignedAmount({ value, currency, locale }: { value: number | null; currency: string | null; locale: string }) {
  if (value === null || value <= 0) return <Amount currency={currency} locale={locale} size="amountBase" value={value} />
  return (
    <View style={styles.signed}>
      <Text variant="amountBase">+</Text>
      <Amount currency={currency} locale={locale} size="amountBase" value={value} />
    </View>
  )
}

function Column({ label, weight, children }: { label: string; weight: number; children: React.ReactNode }) {
  return (
    <View style={[styles.column, { flex: weight }]}>
      <Text numberOfLines={2} tone="muted" variant="label">{label}</Text>
      <View style={styles.value}>{children}</View>
    </View>
  )
}

function Skeleton() {
  const palette = usePalette()
  return <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.skeleton, { backgroundColor: palette.muted }]} />
}

const styles = StyleSheet.create({
  lead: { gap: themeTokens.spacing[2] },
  row: { flexDirection: 'row', alignItems: 'stretch', gap: themeTokens.spacing[3] },
  column: { minWidth: 0, gap: 2 },
  // Values sit on one baseline even when a label wraps to two lines.
  value: { marginTop: 'auto' },
  // A text link rather than a 36pt button, so the line costs 20pt; hitSlop takes it to 44.
  review: { flexDirection: 'row', alignItems: 'center', gap: themeTokens.spacing[3] },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.72 },
  signed: { flexDirection: 'row', alignItems: 'baseline' },
  skeleton: { height: 20, width: '80%', borderRadius: themeTokens.radius.sm },
})
