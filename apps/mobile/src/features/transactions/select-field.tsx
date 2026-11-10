import { useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'

import { Icon } from '@/components/ui/icon'
import { OptionSheet, type SheetOption } from '@/components/ui/sheet'
import { Text } from '@/components/ui/text'
import { themeTokens } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'

/**
 * One form row that opens an `OptionSheet`: the label, then the current choice
 * (or a placeholder) in a single input-shaped control.
 */
export function SelectField<T extends string | number>({
  label,
  options,
  value,
  onChange,
  placeholder,
  disabled = false,
  testID,
}: {
  label: string
  options: readonly SheetOption<T>[]
  value: T | null
  onChange: (value: T) => void
  placeholder: string
  disabled?: boolean
  testID?: string
}) {
  const palette = usePalette()
  const [open, setOpen] = useState(false)
  const current = options.find((option) => option.value === value) ?? null
  return (
    <View style={styles.field}>
      <Text variant="metaStrong">{label}</Text>
      <Pressable
        accessibilityLabel={`${label}, ${current?.label ?? placeholder}`}
        accessibilityRole="button"
        accessibilityState={{ disabled, expanded: open }}
        disabled={disabled}
        hitSlop={{ top: 2, bottom: 2 }}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [
          styles.control,
          { borderColor: palette.input, backgroundColor: palette.background },
          pressed && styles.pressed,
          disabled && styles.dimmed,
        ]}
        testID={testID}
      >
        <Text numberOfLines={1} style={styles.controlText} tone={current ? 'default' : 'muted'} variant="body">
          {current?.label ?? placeholder}
        </Text>
        <Icon color={palette.mutedForeground} name="chevron-down" />
      </Pressable>
      <OptionSheet
        onClose={() => setOpen(false)}
        onSelect={onChange}
        options={options}
        title={label}
        value={value}
        visible={open}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  field: { gap: themeTokens.spacing[2] },
  // Web's SelectTrigger: 40pt, input stroke, 6pt radius, px-3.
  control: {
    minHeight: themeTokens.size.control,
    flexDirection: 'row',
    alignItems: 'center',
    gap: themeTokens.spacing[2],
    borderWidth: 1,
    borderRadius: themeTokens.radius.md,
    paddingHorizontal: themeTokens.spacing[3],
  },
  controlText: { flex: 1, minWidth: 0 },
  pressed: { opacity: 0.72 },
  dimmed: { opacity: 0.5 },
})
