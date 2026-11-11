import { useTranslation } from 'react-i18next'
import { Pressable, StyleSheet, View } from 'react-native'

import { Badge } from '@/components/ui/badge'
import { themeTokens } from '@/theme/tokens'

import type { TransactionTemplateDto } from './templates-contract'

/**
 * The person's saved entries at the top of manual entry. A tap fills the form (it never
 * creates anything); a long press opens the editor for that template. The last chip starts a
 * new one.
 */
export function TemplateChips({
  templates,
  onUse,
  onManage,
  onCreate,
}: {
  templates: readonly TransactionTemplateDto[]
  onUse: (template: TransactionTemplateDto) => void
  onManage: (template: TransactionTemplateDto) => void
  onCreate: () => void
}) {
  const { t } = useTranslation()
  return (
    <View style={styles.row} testID="template-chips">
      {templates.map((template) => (
        <Pressable
          accessibilityHint={t('transactionTemplates.longPressHint')}
          accessibilityLabel={t('transactionTemplates.use', { name: template.name })}
          accessibilityRole="button"
          delayLongPress={350}
          key={template.transactionTemplateKey}
          onLongPress={() => onManage(template)}
          onPress={() => onUse(template)}
        >
          <Badge label={template.name} tone="outline" />
        </Pressable>
      ))}
      <Pressable
        accessibilityLabel={t('transactionTemplates.newTemplate')}
        accessibilityRole="button"
        onPress={onCreate}
      >
        <Badge label={t('transactionTemplates.newTemplate')} tone="muted" />
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: themeTokens.spacing[2],
    paddingBottom: themeTokens.spacing[2],
  },
})
