import { useTranslation } from 'react-i18next'
import { StyleSheet, View } from 'react-native'

import { Text } from '@/components/ui/text'
import { THEN_IMPORT } from '@/features/accounts/after-account-created'
import { NoAccountOptionList } from '@/features/accounts/no-account-options'
import { themeTokens } from '@/theme/tokens'

/**
 * Web's `NoAccountsCard`: Home for a household with no accounts at all, with the three ways in,
 * each opening the flow the app already has. A statement goes into an account, so "Import a
 * statement" adds the account first and then opens the import on it. Home shows it only while
 * the account list is loaded and empty.
 */
export function NoAccountsCard({ onNavigate }: { onNavigate: (href: string) => void }) {
  const { t } = useTranslation()
  return (
    <View style={styles.card} testID="home-no-accounts">
      <Text accessibilityRole="header" variant="metaStrong">{t('home.noAccounts.title')}</Text>
      <NoAccountOptionList
        options={[
          { key: 'connect', icon: 'landmark', label: t('home.noAccounts.connect'), onPress: () => onNavigate('/more/banking/connect') },
          { key: 'import', icon: 'file-text', label: t('home.noAccounts.import'), hint: t('home.noAccounts.importHint'), onPress: () => onNavigate(`/accounts/create?then=${THEN_IMPORT}`) },
          { key: 'manual', icon: 'pencil', label: t('home.noAccounts.manual'), hint: t('home.noAccounts.manualHint'), onPress: () => onNavigate('/accounts/create') },
        ]}
      />
    </View>
  )
}

const styles = StyleSheet.create({ card: { gap: themeTokens.spacing[2] } })
