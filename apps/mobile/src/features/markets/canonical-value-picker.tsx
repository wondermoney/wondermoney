import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, StyleSheet, TextInput, View } from 'react-native'

import { Button } from '@/components/ui/button'
import { FormRow } from '@/components/ui/form-row'
import { Icon } from '@/components/ui/icon'
import { Sheet } from '@/components/ui/sheet'
import { Text } from '@/components/ui/text'
import { themeTokens, type Palette } from '@/theme/tokens'
import { textStyles } from '@/theme/typography'
import { usePalette } from '@/theme/use-palette'

export type CanonicalValuePickerProps = Readonly<{
  label: string
  options: readonly string[]
  selected: string | null
  onSelect: (value: string | null) => void
  /** Kept for callers; the picker reads the palette itself. */
  palette?: Palette
}>

const MAX_VISIBLE_RESULTS = 50

/**
 * One screener filter over a long canonical list (sectors, industries,
 * countries, exchanges) as a form row: the label left, the choice right ("Any"
 * when there is none). Tapping it opens a sheet with a search field and the
 * matching values (at most 50 drawn at once), plus "Clear" while a value is set.
 */
export function CanonicalValuePicker({ label, options, selected, onSelect }: CanonicalValuePickerProps) {
  const { t } = useTranslation()
  const palette = usePalette()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [focused, setFocused] = useState(false)

  const filtered = useMemo(() => {
    const trimmed = query.trim().toLowerCase()
    const matches = trimmed === '' ? options : options.filter((option) => option.toLowerCase().includes(trimmed))
    return matches.slice(0, MAX_VISIBLE_RESULTS)
  }, [options, query])

  const close = () => { setOpen(false); setQuery('') }
  const choose = (value: string | null) => { onSelect(value); close() }

  return (
    <>
      <FormRow expanded={open} label={label} onPress={() => setOpen(true)} placeholder={t('screener.canonicalPicker.any')} value={selected} />
      <Sheet closeLabel={t('common.close')} onClose={close} title={label} visible={open}>
        <View style={styles.body}>
          <TextInput
            accessibilityLabel={t('screener.canonicalPicker.searchPlaceholder', { label })}
            allowFontScaling
            autoCapitalize="none"
            autoCorrect={false}
            onBlur={() => setFocused(false)}
            onChangeText={setQuery}
            onFocus={() => setFocused(true)}
            placeholder={t('screener.canonicalPicker.searchPlaceholder', { label })}
            placeholderTextColor={palette.mutedForeground}
            style={[styles.search, { color: palette.foreground, borderColor: focused ? palette.ring : palette.input, borderWidth: focused ? 2 : 1 }]}
            value={query}
          />
          {selected ? (
            <View style={styles.clear}>
              <Button label={t('screener.canonicalPicker.clear')} onPress={() => choose(null)} size="sm" variant="link" />
            </View>
          ) : null}
          {filtered.length === 0 ? (
            <Text style={styles.empty} tone="muted" variant="body">{t('screener.canonicalPicker.noMatches')}</Text>
          ) : (
            <View>
              {filtered.map((item, index) => {
                const checked = item === selected
                return (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ selected: checked }}
                    key={item}
                    onPress={() => choose(item)}
                    style={({ pressed }) => [styles.option, index > 0 && { borderTopWidth: 1, borderTopColor: palette.border }, pressed && { backgroundColor: palette.muted }]}
                  >
                    <Text style={styles.optionLabel} tone={checked ? 'primary' : 'default'} variant={checked ? 'bodyStrong' : 'body'}>{item}</Text>
                    {checked ? <Icon color={palette.primary} name="check" size={16} /> : null}
                  </Pressable>
                )
              })}
            </View>
          )}
        </View>
      </Sheet>
    </>
  )
}

const styles = StyleSheet.create({
  body: { gap: themeTokens.spacing[3], paddingBottom: themeTokens.spacing[4] },
  search: { ...textStyles.body, minHeight: themeTokens.touchTarget.minimum, borderRadius: themeTokens.radius.md, paddingHorizontal: themeTokens.spacing[3] },
  clear: { alignItems: 'flex-start' },
  option: { minHeight: themeTokens.touchTarget.minimum, flexDirection: 'row', alignItems: 'center', gap: themeTokens.spacing[3], paddingVertical: themeTokens.spacing[3] },
  optionLabel: { flex: 1 },
  empty: { paddingVertical: themeTokens.spacing[2] },
})
