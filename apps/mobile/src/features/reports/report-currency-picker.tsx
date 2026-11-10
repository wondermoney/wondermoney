import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { themeTokens, type Palette } from '@/theme/tokens'
import { textStyles } from '@/theme/typography'

import { Icon } from '@/components/ui/icon'


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
      <Text allowFontScaling style={[styles.label, { color: palette.mutedForeground }]}>{t('reports.filters.currency')}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${t('reports.filters.currency')}, ${selected ?? t('reports.filters.currencyAny')}`}
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((value) => !value)}
        style={({ pressed }) => [styles.summary, { borderColor: palette.input, backgroundColor: palette.background }, pressed && { opacity: 0.72 }]}
      >
        <Text allowFontScaling numberOfLines={1} style={[styles.summaryValue, { color: selected ? palette.foreground : palette.mutedForeground }]}>
          {selected ?? t('reports.filters.currencyAny')}
        </Text>
        <Icon color={palette.mutedForeground} name={expanded ? 'chevron-up' : 'chevron-down'} />
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
  summary: { minHeight: themeTokens.size.control, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: themeTokens.spacing[2], borderWidth: 1, borderRadius: themeTokens.radius.md, paddingHorizontal: themeTokens.spacing[3] },
  label: { ...textStyles.label, fontWeight: '500' as const },
  summaryValue: { ...textStyles.meta, flexShrink: 1 },
  panel: { borderWidth: 1, borderRadius: themeTokens.radius.md, padding: themeTokens.spacing[2], gap: themeTokens.spacing[1] },
  optionRow: { minHeight: themeTokens.touchTarget.minimum, justifyContent: 'center', paddingHorizontal: themeTokens.spacing[2] },
  optionLabel: { ...textStyles.body },
})
