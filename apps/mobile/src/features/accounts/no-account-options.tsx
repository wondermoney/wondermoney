import { Pressable, StyleSheet, View } from 'react-native'

import { Icon, type IconName } from '@/components/ui/icon'
import { Text } from '@/components/ui/text'
import { themeTokens } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'

export type NoAccountOption = Readonly<{
  key: string
  icon: IconName
  label: string
  hint?: string
  disabled?: boolean
  onPress: () => void
}>

/**
 * Web's `NoAccountOptionList` (`components/activation/NoAccountOptions.tsx`): the ways to start
 * without a linked bank, as one hairline container with a divider between rows, each an icon
 * tile, a name, at most one short line and a chevron. Used by onboarding after skipping the
 * bank and by Home while the household has no accounts.
 */
export function NoAccountOptionList({ options, testID }: { options: readonly NoAccountOption[]; testID?: string }) {
  const palette = usePalette()
  return (
    <View style={[styles.list, { borderColor: palette.border }]} testID={testID}>
      {options.map((option, index) => (
        <Pressable
          key={option.key}
          accessibilityLabel={option.hint ? `${option.label}, ${option.hint}` : option.label}
          accessibilityRole="button"
          accessibilityState={{ disabled: option.disabled }}
          disabled={option.disabled}
          onPress={option.onPress}
          style={({ pressed }) => [
            styles.row,
            index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.border },
            pressed && { backgroundColor: palette.muted },
            option.disabled && styles.disabled,
          ]}
          testID={`no-account-option-${option.key}`}
        >
          <View style={[styles.tile, { backgroundColor: palette.muted }]}>
            <Icon color={palette.mutedForeground} name={option.icon} />
          </View>
          <View style={styles.copy}>
            <Text variant="metaStrong">{option.label}</Text>
            {option.hint ? <Text tone="muted" variant="label">{option.hint}</Text> : null}
          </View>
          <Icon color={palette.mutedForeground} name="chevron-right" />
        </Pressable>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  list: { borderWidth: 1, borderRadius: themeTokens.radius.lg, overflow: 'hidden' },
  row: {
    minHeight: themeTokens.touchTarget.minimum,
    flexDirection: 'row',
    alignItems: 'center',
    gap: themeTokens.spacing[3],
    paddingHorizontal: themeTokens.spacing[3],
    paddingVertical: themeTokens.spacing[3],
  },
  tile: { width: 32, height: 32, borderRadius: themeTokens.radius.lg, alignItems: 'center', justifyContent: 'center' },
  copy: { flex: 1, minWidth: 0, gap: 2 },
  disabled: { opacity: 0.5 },
})
