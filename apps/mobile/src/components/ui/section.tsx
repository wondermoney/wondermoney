import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'

import { Text } from '@/components/ui/text'
import { themeTokens } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'

/**
 * A section head and its content.
 *
 * The head is `section` role — 16/600, sentence case. Never uppercase, never
 * letterspaced: the app carried three different house styles for the same
 * marker (`PREVIEW`, a `Preview` pill, `TARGET`) and the system has one.
 *
 * `action` is a single trailing control — "See all", "Edit". Not a row of them.
 */
export function Section({
  title,
  action,
  children,
  style,
  testID,
}: {
  title?: string
  action?: React.ReactNode
  children: React.ReactNode
  style?: StyleProp<ViewStyle>
  testID?: string
}) {
  return (
    <View style={[styles.section, style]} testID={testID}>
      {title || action ? (
        <View style={styles.head}>
          {title ? (
            <Text accessibilityRole="header" variant="section" style={styles.title}>
              {title}
            </Text>
          ) : (
            <View style={styles.title} />
          )}
          {action}
        </View>
      ) : null}
      {children}
    </View>
  )
}

/**
 * The empty state: a realistic, data-forward preview of what will be here,
 * plus the one action that fills it.
 *
 * Not an illustration. An empty state that shows the shape of the real thing
 * teaches the screen; a drawing of a box teaches nothing, and empty states are
 * where every significant defect in the web half hid.
 */
export function EmptyState({
  title,
  message,
  preview,
  action,
  testID,
}: {
  title: string
  message?: string
  preview?: React.ReactNode
  action?: React.ReactNode
  testID?: string
}) {
  const palette = usePalette()
  return (
    <View style={[styles.empty, { borderColor: palette.border, backgroundColor: palette.card }]} testID={testID}>
      <Text accessibilityRole="header" variant="section">
        {title}
      </Text>
      {message ? (
        <Text variant="body" tone="muted">
          {message}
        </Text>
      ) : null}
      {preview}
      {action}
    </View>
  )
}

const styles = StyleSheet.create({
  section: { gap: themeTokens.spacing[3] },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: themeTokens.spacing[3],
  },
  title: { flexShrink: 1 },
  empty: {
    borderWidth: 1,
    borderRadius: themeTokens.radius.lg,
    padding: themeTokens.spacing[5],
    gap: themeTokens.spacing[3],
  },
})
