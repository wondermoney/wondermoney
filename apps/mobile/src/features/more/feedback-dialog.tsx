import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, StyleSheet, Text, TextInput, useColorScheme, View } from 'react-native'

import { themeTokens, type Palette } from '@/theme/tokens'
import { textStyles } from '@/theme/typography'

import type { FeedbackCategory } from './link-policy'

export type FeedbackDialogProps = Readonly<{
  visible: boolean
  pending: boolean
  failed: boolean
  onCancel: () => void
  onSubmit: (input: { category: FeedbackCategory; message: string }) => void | Promise<void>
}>

const CATEGORIES: readonly FeedbackCategory[] = ['bug', 'feature_request', 'other']


/** A categorized feedback dialog (bug / feature request / other + free text), submitted
 * through the approved support-mail channel — see link-policy's buildFeedbackMailDestination. */
export function FeedbackDialog({ visible, pending, failed, onCancel, onSubmit }: FeedbackDialogProps) {
  const { t } = useTranslation()
  const palette = themeTokens.colors[useColorScheme() === 'dark' ? 'dark' : 'light']
  const [category, setCategory] = useState<FeedbackCategory | null>(null)
  const [message, setMessage] = useState('')
  const [validationError, setValidationError] = useState<string | null>(null)

  if (!visible) return null

  const submit = async () => {
    if (pending) return
    if (!category) {
      setValidationError(t('more.feedback.categoryRequired'))
      return
    }
    if (!message.trim()) {
      setValidationError(t('more.feedback.messageRequired'))
      return
    }
    setValidationError(null)
    await onSubmit({ category, message })
  }

  return (
    <View style={styles.scrim}>
      <View accessibilityViewIsModal style={[styles.sheet, { backgroundColor: palette.card }]}>
        <Text accessibilityRole="header" allowFontScaling style={[styles.title, { color: palette.foreground }]}>
          {t('more.feedback.title')}
        </Text>
        <Text allowFontScaling style={[styles.description, { color: palette.mutedForeground }]}>
          {t('more.feedback.description')}
        </Text>

        <View accessibilityRole="radiogroup" style={styles.categories}>
          {CATEGORIES.map((value) => (
            <Pressable
              key={value}
              accessibilityRole="radio"
              accessibilityLabel={t(`more.feedback.categories.${value}`)}
              accessibilityState={{ checked: category === value, disabled: pending }}
              disabled={pending}
              onPress={() => { setCategory(value); setValidationError(null) }}
              style={({ pressed }) => [
                styles.category,
                { borderColor: category === value ? palette.primary : palette.border },
                category === value && { backgroundColor: palette.primarySoft },
                pressed && styles.pressed,
              ]}
            >
              <Text allowFontScaling style={[styles.categoryText, { color: palette.foreground }]}>
                {t(`more.feedback.categories.${value}`)}
              </Text>
            </Pressable>
          ))}
        </View>

        <TextInput
          accessibilityLabel={t('more.feedback.messageLabel')}
          editable={!pending}
          multiline
          onChangeText={(value) => { setMessage(value); setValidationError(null) }}
          placeholder={t('more.feedback.messagePlaceholder')}
          placeholderTextColor={palette.mutedForeground}
          style={[styles.input, { color: palette.foreground, borderColor: palette.border, backgroundColor: palette.background }]}
          value={message}
        />

        {validationError ? (
          <Text accessibilityRole="alert" allowFontScaling style={[styles.notice, { color: palette.destructive }]}>
            {validationError}
          </Text>
        ) : null}
        {failed ? (
          <Text accessibilityRole="alert" allowFontScaling style={[styles.notice, { color: palette.destructive }]}>
            {t('more.feedback.submitError')}
          </Text>
        ) : null}

        <View style={styles.actions}>
          <DialogButton label={t('common.cancel')} onPress={onCancel} disabled={pending} palette={palette} />
          <DialogButton
            label={pending ? t('more.feedback.sending') : t('more.feedback.submit')}
            onPress={() => void submit()}
            disabled={pending}
            busy={pending}
            palette={palette}
            primary
          />
        </View>
      </View>
    </View>
  )
}

function DialogButton({ label, onPress, disabled, busy = false, palette, primary = false }: {
  label: string
  onPress: () => void
  disabled: boolean
  busy?: boolean
  palette: Palette
  primary?: boolean
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, busy }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { borderColor: primary ? 'transparent' : palette.input, backgroundColor: primary ? palette.primary : 'transparent' },
        (pressed || disabled) && styles.pressed,
      ]}
    >
      <Text allowFontScaling style={[styles.buttonText, { color: primary ? palette.primaryForeground : palette.foreground }]}>
        {label}
      </Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  scrim: {
    position: 'absolute',
    inset: 0,
    zIndex: 20,
    justifyContent: 'center',
    padding: themeTokens.spacing[5],
    backgroundColor: themeTokens.colors.light.scrim,
  },
  sheet: {
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
    borderRadius: themeTokens.radius.xl,
    padding: themeTokens.spacing[4],
    gap: themeTokens.spacing[4],
    ...themeTokens.shadow.overlay,
  },
  title: { ...textStyles.section, fontWeight: '700' as const },
  description: { ...textStyles.body },
  categories: { flexDirection: 'row', flexWrap: 'wrap', gap: themeTokens.spacing[2] },
  category: {
    minHeight: themeTokens.touchTarget.minimum,
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: themeTokens.radius.pill,
    paddingHorizontal: themeTokens.spacing[4],
  },
  categoryText: { ...textStyles.bodyStrong, fontWeight: '600' as const },
  input: { ...textStyles.body, minHeight: 96, borderWidth: 1, borderRadius: themeTokens.radius.md, padding: themeTokens.spacing[3], textAlignVertical: 'top' },
  notice: { ...textStyles.meta },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: themeTokens.spacing[2], justifyContent: 'flex-end' },
  button: {
    minHeight: themeTokens.touchTarget.minimum,
    minWidth: themeTokens.touchTarget.minimum,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: themeTokens.radius.md,
    paddingHorizontal: themeTokens.spacing[4],
  },
  buttonText: { ...textStyles.action },
  pressed: { opacity: 0.72 },
})
