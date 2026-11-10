import { Fragment } from 'react'
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native'

import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { SafeAreaView } from '@/components/ui/screen-safe-area'
import { Text } from '@/components/ui/text'
import { themeTokens } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'

/**
 * Web's `DrawerDialog` / `Sheet` at phone width: a bottom sheet with its title
 * and a close control on one line, scrolling content, and an optional footer.
 * Tapping the scrim closes it.
 */
export function Sheet({
  visible,
  title,
  closeLabel,
  onClose,
  footer,
  children,
  testID,
}: {
  visible: boolean
  title: string
  /** The close control's accessible name ("Close"). Without it there is no close button, only the scrim. */
  closeLabel?: string
  onClose: () => void
  footer?: React.ReactNode
  children: React.ReactNode
  testID?: string
}) {
  const palette = usePalette()
  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible={visible}>
      <Pressable accessibilityLabel={closeLabel ?? title} accessibilityRole="button" onPress={onClose} style={[styles.backdrop, { backgroundColor: palette.scrim }]} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <SafeAreaView
          edges={['bottom']}
          style={[styles.sheet, styles.sheetTall, { backgroundColor: palette.popover, borderColor: palette.border }, themeTokens.shadow.overlay]}
          testID={testID}
        >
          <View style={styles.titleRow}>
            <Text accessibilityRole="header" style={styles.title} variant="section">{title}</Text>
            {closeLabel ? <Button icon="x" label={closeLabel} onPress={onClose} size="icon" variant="ghost" /> : null}
          </View>
          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled" style={styles.scroll}>
            {children}
          </ScrollView>
          {footer ? <View style={[styles.footer, { borderTopColor: palette.border }]}>{footer}</View> : null}
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  )
}

/** `leading` is a decorative mark before the label (an account's `EntityMark size="sm"`); the label stays the accessible name. */
export type SheetOption<T extends string | number> = Readonly<{ value: T; label: string; meta?: string; destructive?: boolean; leading?: React.ReactNode }>
export type OptionGroup<T extends string | number> = Readonly<{ label?: string; options: readonly SheetOption<T>[] }>

/**
 * The open state of web's Select / DropdownMenu at phone width: a bottom sheet
 * of hairline-separated rows.
 *
 * - `choice` (default) is a radio group: the current value in violet with a check.
 * - `menu` is a list of actions (an overflow menu): menu items, nothing selected.
 *
 * Pass `options`, or `groups` for labelled runs (web `SelectGroup` + `SelectLabel`).
 * Choosing closes the sheet, then calls `onSelect`.
 */
export function OptionSheet<T extends string | number>({
  visible,
  title,
  options,
  groups,
  value,
  mode = 'choice',
  dismissLabel,
  onSelect,
  onClose,
  testID,
}: {
  visible: boolean
  title: string
  options?: readonly SheetOption<T>[]
  groups?: readonly OptionGroup<T>[]
  value?: T | null
  mode?: 'choice' | 'menu'
  /** The scrim's accessible name; defaults to the title. */
  dismissLabel?: string
  onSelect: (value: T) => void
  onClose: () => void
  testID?: string
}) {
  const palette = usePalette()
  const runs: readonly OptionGroup<T>[] = groups ?? [{ options: options ?? [] }]
  const choice = mode === 'choice'
  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible={visible}>
      <Pressable accessibilityLabel={dismissLabel ?? title} onPress={onClose} style={[styles.backdrop, { backgroundColor: palette.scrim }]} />
      <SafeAreaView
        edges={['bottom']}
        style={[styles.sheet, { backgroundColor: palette.popover, borderColor: palette.border }, themeTokens.shadow.overlay]}
        testID={testID}
      >
        <Text accessibilityRole="header" style={styles.optionTitle} variant="section">{title}</Text>
        <ScrollView accessibilityLabel={title} accessibilityRole={choice ? 'radiogroup' : 'menu'} style={styles.scroll}>
          {runs.map((group, groupIndex) => (
            <Fragment key={group.label ?? groupIndex}>
              {group.label ? (
                <Text style={[styles.groupLabel, groupIndex > 0 && { borderTopWidth: 1, borderTopColor: palette.border }]} tone="muted" variant="label">
                  {group.label}
                </Text>
              ) : null}
              {group.options.map((option, index) => {
                const selected = choice && value === option.value
                const ruled = index > 0 || (groupIndex > 0 && !group.label)
                return (
                  <Pressable
                    accessibilityLabel={option.label}
                    accessibilityRole={choice ? 'radio' : 'menuitem'}
                    accessibilityState={choice ? { checked: selected, selected } : undefined}
                    key={String(option.value)}
                    onPress={() => { onClose(); onSelect(option.value) }}
                    style={({ pressed }) => [
                      styles.option,
                      ruled && { borderTopWidth: 1, borderTopColor: palette.border },
                      pressed && { backgroundColor: palette.muted },
                    ]}
                  >
                    {option.leading}
                    <View style={styles.optionText}>
                      <Text numberOfLines={1} tone={option.destructive ? 'destructive' : selected ? 'primary' : 'default'} variant={selected ? 'bodyStrong' : 'body'}>
                        {option.label}
                      </Text>
                      {option.meta ? <Text tone="muted" variant="meta">{option.meta}</Text> : null}
                    </View>
                    {selected ? <Icon color={palette.primary} name="check" /> : null}
                  </Pressable>
                )
              })}
            </Fragment>
          ))}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1 },
  sheet: {
    maxHeight: '75%',
    borderTopWidth: 1,
    borderTopLeftRadius: themeTokens.radius.xl,
    borderTopRightRadius: themeTokens.radius.xl,
    paddingTop: themeTokens.spacing[4],
    paddingHorizontal: themeTokens.layout.screenPadding,
  },
  sheetTall: { maxHeight: '85%', paddingTop: themeTokens.spacing[3] },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: themeTokens.spacing[3] },
  title: { flexShrink: 1 },
  optionTitle: { paddingBottom: themeTokens.spacing[2] },
  scroll: { flexGrow: 0 },
  body: { gap: themeTokens.spacing[4], paddingVertical: themeTokens.spacing[3] },
  footer: { borderTopWidth: 1, paddingVertical: themeTokens.spacing[3], gap: themeTokens.spacing[2] },
  groupLabel: { paddingTop: themeTokens.spacing[3], paddingBottom: themeTokens.spacing[1] },
  option: {
    minHeight: themeTokens.touchTarget.minimum + 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: themeTokens.spacing[3],
    paddingVertical: themeTokens.spacing[3],
  },
  optionText: { flex: 1, gap: 2 },
})
