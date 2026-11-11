import { useState } from 'react'
import { StyleSheet, TextInput, View } from 'react-native'

import { Text } from '@/components/ui/text'
import { themeTokens } from '@/theme/tokens'
import { textStyles } from '@/theme/typography'
import { usePalette } from '@/theme/use-palette'

/**
 * Web's form field (`FormItem` + `FormLabel` + `Input`): the label above the
 * control at 14/500, a 40pt control with the input stroke and a 6pt radius,
 * the violet focus ring, and a destructive border when invalid. A multiline
 * field grows from 80pt (web `Textarea` `min-h-16`, rounded up to the scale).
 */
export function TextField({
  label,
  invalid = false,
  multiline = false,
  editable = true,
  hint,
  style,
  ...props
}: { label: string; invalid?: boolean; hint?: string | null } & React.ComponentProps<typeof TextInput>) {
  const palette = usePalette()
  const [focused, setFocused] = useState(false)
  return (
    <View style={styles.field}>
      <Text variant="metaStrong">{label}</Text>
      <TextInput
        accessibilityLabel={label}
        accessibilityState={{ disabled: !editable }}
        editable={editable}
        multiline={multiline}
        onBlur={(event) => { setFocused(false); props.onBlur?.(event) }}
        onFocus={(event) => { setFocused(true); props.onFocus?.(event) }}
        placeholderTextColor={palette.mutedForeground}
        style={[
          styles.input,
          multiline && styles.multiline,
          {
            color: palette.foreground,
            backgroundColor: palette.background,
            borderColor: focused ? palette.ring : invalid ? palette.destructiveText : palette.input,
            borderWidth: focused ? 2 : 1,
          },
          !editable && styles.disabled,
          style,
        ]}
        {...props}
      />
      {hint ? (
        <Text accessibilityLiveRegion="polite" style={styles.hint} tone="muted" variant="meta">
          {hint}
        </Text>
      ) : null}
    </View>
  )
}

/** A quiet inline notice (DESIGN.md's quiet register): a hairline in the tone's text colour, plain surface. */
export function FormNotice({ children, tone = 'default', testID }: { children: string; tone?: 'default' | 'destructive'; testID?: string }) {
  const palette = usePalette()
  return (
    <Text
      accessibilityRole="alert"
      style={[styles.notice, { borderColor: tone === 'destructive' ? palette.destructiveText : palette.border }]}
      testID={testID}
      tone={tone === 'destructive' ? 'destructive' : 'default'}
      variant="meta"
    >
      {children}
    </Text>
  )
}

const styles = StyleSheet.create({
  field: { gap: themeTokens.spacing[2] },
  input: {
    ...textStyles.body,
    minHeight: themeTokens.size.control,
    borderRadius: themeTokens.radius.md,
    paddingHorizontal: themeTokens.spacing[3],
    paddingVertical: themeTokens.spacing[2],
  },
  multiline: { minHeight: 80, textAlignVertical: 'top' },
  disabled: { opacity: 0.5 },
  hint: { textAlign: 'right' },
  notice: { borderWidth: 1, borderRadius: themeTokens.radius.md, padding: themeTokens.spacing[3] },
})
