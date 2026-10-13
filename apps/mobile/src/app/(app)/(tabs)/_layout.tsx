import { useTranslation } from 'react-i18next'

import { ProductNavigation } from '@/features/navigation/product-navigation'

export default function ProductTabsLayout() {
  const { t } = useTranslation()
  return (
    <ProductNavigation
      labels={{
        home: t('navigation.home'),
        accounts: t('navigation.accounts'),
        budgets: t('navigation.budgets'),
        portfolio: t('navigation.portfolio'),
        more: t('navigation.more'),
      }}
    />
  )
}
