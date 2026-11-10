import { StyleSheet, View } from 'react-native'

import { Text } from '@/components/ui/text'
import { themeTokens } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'

export type NoticeTone = 'default' | 'destructive' | 'warning'

/**
 * Web's quiet-register alert (`Alert` with no tint): a hairline border in the
 * status ink on the canvas, a title and/or message, and at most one action.
 * One accessible alert whose name is the whole message. For the semantic
 * register with info/success tones, use `Banner`.
 */
export function Notice({
  title,
  message,
  tone = 'default',
  action,
  testID,
}: {
  title?: string
  message?: string
  tone?: NoticeTone
  /** A retry or a resolve. At most one. */
  action?: React.ReactNode
  testID?: string
}) {
  const palette = usePalette()
  const border = tone === 'destructive' ? palette.destructiveText : tone === 'warning' ? palette.warningText : palette.border
  const ink = tone === 'default' ? 'default' : tone
  return (
    <View style={[styles.notice, { borderColor: border }]} testID={testID}>
      <View accessible accessibilityLabel={[title, message].filter(Boolean).join('. ')} accessibilityRole="alert" style={styles.copy}>
        {title ? <Text tone={ink} variant="metaStrong">{title}</Text> : null}
        {message ? <Text tone={title ? 'muted' : ink} variant="meta">{message}</Text> : null}
      </View>
      {action}
    </View>
  )
}

const styles = StyleSheet.create({
  notice: { borderWidth: 1, borderRadius: themeTokens.radius.lg, padding: themeTokens.spacing[4], gap: themeTokens.spacing[3], alignItems: 'flex-start' },
  copy: { gap: themeTokens.spacing[1], alignSelf: 'stretch' },
})
