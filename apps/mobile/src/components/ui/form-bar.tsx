import { StyleSheet, View } from 'react-native'

import { IconButton } from '@/components/ui/icon-button'
import { Text } from '@/components/ui/text'
import { themeTokens } from '@/theme/tokens'

/**
 * The bar a flow screen (create, edit) opens with, in place of the app's top
 * bar: close on the left, an optional title, save on the right in violet.
 *
 * - Close (✕) leaves the flow; pass `router.back()` or the screen's own exit.
 * - Save (✓) is disabled until the form is valid (`saveDisabled`) and shows a
 *   spinner while the request runs (`saving`, which also announces busy).
 *   There is no full-width submit at the bottom of a flow and no back link.
 * - Without `onSave` the bar shows close only (a loading or error state).
 *
 * The bar does not own the safe area: put it first inside the screen's
 * `SafeAreaView` (flow routes have no shell top bar, so that view pads the
 * notch), outside the `ScrollView` so it stays put.
 */
export function FormBar({
  title,
  onClose,
  closeLabel,
  closeDisabled = false,
  onSave,
  saveLabel,
  saveDisabled = false,
  saving = false,
  testID,
}: {
  title?: string
  onClose: () => void
  /** "Close". */
  closeLabel: string
  closeDisabled?: boolean
  onSave?: () => void
  /** What the save does, read by screen readers ("Save", "Review transaction"). */
  saveLabel?: string
  saveDisabled?: boolean
  saving?: boolean
  testID?: string
}) {
  return (
    <View style={styles.bar} testID={testID}>
      <IconButton accessibilityLabel={closeLabel} disabled={closeDisabled} icon="x" onPress={onClose} testID={testID ? `${testID}-close` : undefined} />
      <View style={styles.titleSlot}>
        {title ? (
          <Text accessibilityRole="header" numberOfLines={1} variant="section">
            {title}
          </Text>
        ) : null}
      </View>
      {onSave ? (
        <IconButton
          accessibilityLabel={saveLabel ?? ''}
          disabled={saveDisabled}
          icon="check"
          loading={saving}
          onPress={onSave}
          testID={testID ? `${testID}-save` : undefined}
          tone="primary"
        />
      ) : (
        <View style={styles.spacer} />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  bar: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: themeTokens.spacing[2],
    // The glyphs' 44pt targets sit 6pt in, so the drawn glyph lines up with
    // the content's 16pt gutter.
    paddingHorizontal: themeTokens.layout.screenPadding - 11,
  },
  titleSlot: { flex: 1, minWidth: 0 },
  spacer: { width: themeTokens.touchTarget.minimum },
})
