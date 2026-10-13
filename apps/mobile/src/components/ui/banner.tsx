import { StyleSheet, View } from 'react-native'

import { Text } from '@/components/ui/text'
import { themeTokens } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'

export type BannerTone = 'destructive' | 'warning' | 'info' | 'success'

/**
 * The quiet semantic register: a hairline border and `-text` ink on the plain
 * surface, with **no surface tint**.
 *
 * The tint is what made this fail on the web half. A `-text` token on a 5%
 * fill of its own hue measured warning 4.53:1, info 4.44:1, success 4.55:1 —
 * one under the floor and two inside rounding distance of it. At 10% all three
 * failed. Dropping the tint puts the same ink on the plain surface at 4.7–4.8
 * with real margin, and a hairline border is already how this system draws
 * every other boundary.
 *
 * Use this where the status *annotates* content that is doing the talking. Use
 * `Badge` — solid fill plus its own foreground — where the element **is** the
 * status.
 */
export function Banner({
  tone,
  title,
  message,
  action,
  testID,
}: {
  tone: BannerTone
  title?: string
  message: string
  /** A retry or a resolve. At most one. */
  action?: React.ReactNode
  testID?: string
}) {
  const palette = usePalette()
  const ink = {
    destructive: palette.destructiveText,
    warning: palette.warningText,
    info: palette.infoText,
    success: palette.successText,
  }[tone]

  return (
    <View
      accessibilityRole={tone === 'destructive' ? 'alert' : 'summary'}
      accessible
      style={[styles.banner, { borderColor: ink, backgroundColor: palette.card }]}
      testID={testID}
    >
      <View style={styles.body}>
        {title ? (
          <Text variant="bodyStrong" style={{ color: ink }}>
            {title}
          </Text>
        ) : null}
        <Text variant="body">{message}</Text>
      </View>
      {action}
    </View>
  )
}

const styles = StyleSheet.create({
  banner: {
    // A hairline of the semantic ink at reduced weight: enough to identify the
    // register without becoming a coloured block.
    borderWidth: 1,
    borderRadius: themeTokens.radius.lg,
    padding: themeTokens.spacing[4],
    gap: themeTokens.spacing[3],
  },
  body: { gap: themeTokens.spacing[1] },
})
