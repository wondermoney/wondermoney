import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'

import { Text } from '@/components/ui/text'
import { themeTokens } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'

/**
 * A section head and its content.
 *
 * `variant="ruled"` is web's `RuledSection` (`components/ui/RuledSection.tsx`):
 * a 2pt foreground rule above, 16pt under the rule, an 18/600 head, 24pt to the
 * content — the page reads as one statement instead of a wall of cards. The
 * default `plain` keeps the head without the rule (older call sites).
 *
 * `variant="open"` is the calm-structure section: no rule at all, a 20/600
 * head in full foreground and 16pt to the content. The screen separates open
 * sections with space (32–40pt), not lines. Pilot screens (Home) use it; the
 * other screens keep `ruled` until they move over.
 *
 * @param title   sentence case, `section` role. Never uppercase, never tracked.
 * @param action  one trailing control ("See all"), not a row of them.
 * @param aside   muted 14px text at the head's end (web `aside`), e.g. a count.
 * @param variant `ruled` | `plain` (default) | `open`.
 */
export function Section({
  title,
  action,
  aside,
  variant = 'plain',
  children,
  style,
  testID,
}: {
  title?: string
  action?: React.ReactNode
  aside?: string
  variant?: 'ruled' | 'plain' | 'open'
  children: React.ReactNode
  style?: StyleProp<ViewStyle>
  testID?: string
}) {
  const palette = usePalette()
  const ruled = variant === 'ruled'
  const open = variant === 'open'
  return (
    <View
      style={[styles.section, ruled && [styles.ruled, { borderTopColor: palette.foreground }], open && styles.open, style]}
      testID={testID}
    >
      {title || action || aside ? (
        <View style={styles.head}>
          {title ? (
            <Text accessibilityRole="header" variant={open ? 'heading' : 'section'} style={styles.title}>
              {title}
            </Text>
          ) : (
            <View style={styles.title} />
          )}
          {aside ? (
            <Text tone="muted" variant="meta">
              {aside}
            </Text>
          ) : null}
          {action}
        </View>
      ) : null}
      {children}
    </View>
  )
}

/**
 * A small heading inside a section or card — web's `SectionHeader`
 * (`text-sm font-medium`) — with an optional trailing control.
 */
export function SectionHeading({ title, action, testID }: { title: string; action?: React.ReactNode; testID?: string }) {
  return (
    <View style={styles.head} testID={testID}>
      <Text accessibilityRole="header" style={styles.title} variant="metaStrong">
        {title}
      </Text>
      {action}
    </View>
  )
}

/**
 * A full-width divider. `hairline` (default) is web's `border-border` 1pt rule
 * between rows and stats; `rule` is the 2pt foreground rule that opens a
 * ruled section or a ledger's filter row (`border-foreground border-t-2`).
 */
export function Divider({ variant = 'hairline', style }: { variant?: 'hairline' | 'rule'; style?: StyleProp<ViewStyle> }) {
  const palette = usePalette()
  return (
    <View
      accessible={false}
      style={[
        variant === 'rule'
          ? { height: 2, backgroundColor: palette.foreground }
          : { height: 1, backgroundColor: palette.border },
        style,
      ]}
    />
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
  open: { gap: themeTokens.spacing[4] },
  ruled: { borderTopWidth: 2, paddingTop: themeTokens.spacing[4], gap: themeTokens.spacing[6] },
  head: {
    flexDirection: 'row',
    alignItems: 'baseline',
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
