import { useTranslation } from 'react-i18next'
import { StyleSheet, View } from 'react-native'

import { Button } from '@/components/ui/button'
import { Sheet } from '@/components/ui/sheet'
import { Text } from '@/components/ui/text'
import { themeTokens } from '@/theme/tokens'

import type { RuleSuggestionDto } from './rules-contract'
import { useDismissRuleSuggestion } from './use-rules'

/**
 * After a category change that repeats a pattern of the member's own recategorizations: "Always
 * categorize transactions like this as Groceries?", as web's toast. **Create rule** opens the rule
 * editor filled in with the suggestion (`onCreate`), with its preview; **Don't suggest again**
 * dismisses it for good; closing leaves it to come back the next time.
 */
export function RuleSuggestionPrompt({
  suggestion,
  categoryName,
  onCreate,
  onClose,
}: {
  suggestion: RuleSuggestionDto
  /** The category's display name; the API's raw name is the fallback. */
  categoryName: string | undefined
  onCreate: (suggestion: RuleSuggestionDto) => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const dismiss = useDismissRuleSuggestion()

  return (
    <Sheet
      closeLabel={t('common.close')}
      footer={(
        <View style={styles.actions}>
          <Button
            disabled={dismiss.isPending}
            label={t('rules.suggestion.dismiss')}
            onPress={() => dismiss.mutate(suggestion.fingerprint, { onSettled: onClose })}
            variant="secondary"
          />
          <Button label={t('rules.suggestion.create')} onPress={() => onCreate(suggestion)} />
        </View>
      )}
      onClose={onClose}
      title={t('rules.suggestion.title', { category: categoryName ?? suggestion.category.name })}
      visible
    >
      <View style={styles.body}>
        <Text variant="body">{t('rules.suggestion.description', { count: suggestion.matchCount, days: suggestion.windowDays })}</Text>
      </View>
    </Sheet>
  )
}

const styles = StyleSheet.create({
  body: { gap: themeTokens.spacing[2], paddingBottom: themeTokens.spacing[2] },
  actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: themeTokens.spacing[2] },
})
