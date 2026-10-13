import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { themeTokens, type Palette } from '@/theme/tokens'
import { textStyles } from '@/theme/typography'


export type ReportCurrencyPickerProps = Readonly<{
  currencies: readonly string[]
  selected: string | undefined
  onChange: (currency: string | undefined) => void
  palette: Palette
}>

/** Currency lists here are always small (the distinct currencies actually present across the
 * user's own accounts — see deriveAvailableCurrencies), so this is a plain single-select list, no
 * search needed unlike the account/category/merchant pickers. */
export function ReportCurrencyPicker({ currencies, selected, onChange, palette }: ReportCurrencyPickerProps) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)

  return (
    <View style={styles.field}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${t('reports.filters.currency')}, ${selected ?? t('reports.filters.currencyAny')}`}
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((value) => !value)}
        style={[styles.summary, { borderColor: palette.border, backgroundColor: palette.card }]}
      >
        <Text allowFontScaling style={[styles.label, { color: palette.foreground }]}>{t('reports.filters.currency')}</Text>
        <Text allowFontScaling style={[styles.summaryValue, { color: selected ? palette.foreground : palette.mutedForeground }]}>
          {selected ?? t('reports.filters.currencyAny')}
        </Text>
      </Pressable>

      {expanded ? (
        <View style={[styles.panel, { borderColor: palette.border, backgroundColor: palette.card }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: selected === undefined }}
            onPress={() => { onChange(undefined); setExpanded(false) }}
            style={styles.optionRow}
          >
            <Text allowFontScaling style={[styles.optionLabel, { color: selected === undefined ? palette.primary : palette.foreground }]}>{t('reports.filters.currencyAny')}</Text>
          </Pressable>
          {currencies.map((currency) => (
            <Pressable
              key={currency}
              accessibilityRole="button"
              accessibilityState={{ selected: currency === selected }}
              onPress={() => { onChange(currency); setExpanded(false) }}
              style={styles.optionRow}
            >
              <Text allowFontScaling style={[styles.optionLabel, { color: currency === selected ? palette.primary : palette.foreground }]}>{currency}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  field: { gap: themeTokens.spacing[2] },
  summary: { minHeight: themeTokens.touchTarget.minimum, borderWidth: 1, borderRadius: themeTokens.radius.md, paddingHorizontal: themeTokens.spacing[3], paddingVertical: themeTokens.spacing[2], gap: themeTokens.spacing[1] },
  label: { ...textStyles.bodyStrong, fontWeight: '600' as const },
  summaryValue: { ...textStyles.body },
  panel: { borderWidth: 1, borderRadius: themeTokens.radius.md, padding: themeTokens.spacing[2], gap: themeTokens.spacing[1] },
  optionRow: { minHeight: themeTokens.touchTarget.minimum, justifyContent: 'center', paddingHorizontal: themeTokens.spacing[2] },
  optionLabel: { ...textStyles.body },
})
