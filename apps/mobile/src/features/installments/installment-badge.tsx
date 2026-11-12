import { useTranslation } from 'react-i18next'
import { View } from 'react-native'

import { Badge } from '@/components/ui/badge'

export type InstallmentMarker = Readonly<{ installmentNumber: number; installmentCount: number }>

/** "Installment 3 of 12": the words a screen reader says for the "3/12" badge. */
export function useInstallmentLabel() {
  const { t } = useTranslation()
  return (installment: InstallmentMarker) => t('installments.badgeLabel', { number: installment.installmentNumber, total: installment.installmentCount })
}

/**
 * The "3/12" on a posted transaction that is one installment of a plan. Nothing for a row that
 * is not one. The row's own accessible name should carry `useInstallmentLabel` too: a pressable
 * row reads as one element, so a screen reader does not reach this badge on its own.
 */
export function InstallmentBadge({ installment, testID = 'installment-badge' }: { installment: InstallmentMarker | null | undefined; testID?: string }) {
  const label = useInstallmentLabel()
  if (!installment) return null
  return (
    <View accessibilityLabel={label(installment)} accessible testID={testID}>
      <Badge label={`${installment.installmentNumber}/${installment.installmentCount}`} tone="outline" />
    </View>
  )
}
