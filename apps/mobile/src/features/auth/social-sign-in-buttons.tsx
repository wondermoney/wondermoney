import * as AppleAuthentication from 'expo-apple-authentication'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import type { NativeIdentityProviderId } from '@/lib/auth/native-identity'
import { themeTokens, type Palette } from '@/theme/tokens'
import { textStyles } from '@/theme/typography'

import type { SocialSignInFailure } from './use-social-sign-in'

export type SocialSignInButtonsProps = Readonly<{
  /** Rendered in the order given; the hook puts Apple first (App Store Guideline 4.8). */
  providers: readonly NativeIdentityProviderId[]
  pending: NativeIdentityProviderId | null
  failure: SocialSignInFailure | null
  onPress: (provider: NativeIdentityProviderId) => void
  palette: Palette
  scheme: 'light' | 'dark'
}>

/**
 * The Apple and Google sign-in buttons, composed into the sign-in and sign-up routes
 * (never into `SignInScreen`, which stays provider-agnostic).
 *
 * Both buttons share one size so neither reads as the lesser option: Apple's is the
 * system `ASAuthorizationAppleIDButton`, which is Apple-approved and localized on its
 * own, and Google's matches its box exactly.
 */
export function SocialSignInButtons({
  providers,
  pending,
  failure,
  onPress,
  palette,
  scheme,
}: SocialSignInButtonsProps) {
  const { t } = useTranslation()
  if (providers.length === 0) return null

  return (
    <View style={styles.group}>
      <View style={styles.divider}>
        <View style={[styles.dividerRule, { backgroundColor: palette.border }]} />
        <Text allowFontScaling style={[styles.dividerLabel, { color: palette.mutedForeground }]}>
          {t('auth.social.divider')}
        </Text>
        <View style={[styles.dividerRule, { backgroundColor: palette.border }]} />
      </View>

      {providers.map((provider) => (provider === 'apple' ? (
        <AppleAuthentication.AppleAuthenticationButton
          key={provider}
          buttonStyle={scheme === 'dark'
            ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
            : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
          buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
          cornerRadius={themeTokens.radius.md}
          onPress={() => onPress('apple')}
          style={[styles.button, pending !== null && styles.buttonBusy]}
          testID="social-sign-in-apple"
        />
      ) : (
        <GoogleButton
          key={provider}
          busy={pending !== null}
          label={pending === 'google' ? t('auth.social.signingIn') : t('auth.social.google')}
          onPress={() => onPress('google')}
          palette={palette}
        />
      )))}

      {failure ? (
        <Text
          accessible
          accessibilityLabel={t('auth.social.errors.unavailable')}
          accessibilityRole="alert"
          allowFontScaling
          style={[styles.error, { color: palette.destructive }]}
        >
          {t('auth.social.errors.unavailable')}
        </Text>
      ) : null}
    </View>
  )
}

function GoogleButton({
  busy,
  label,
  onPress,
  palette,
}: Readonly<{ busy: boolean; label: string; onPress: () => void; palette: Palette }>) {
  const [focused, setFocused] = useState(false)
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: busy, busy }}
      disabled={busy}
      onBlur={() => setFocused(false)}
      onFocus={() => setFocused(true)}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        styles.googleButton,
        { backgroundColor: palette.card, borderColor: palette.border },
        focused && { borderWidth: 2, borderColor: palette.foreground },
        (pressed || busy) && styles.buttonBusy,
      ]}
      testID="social-sign-in-google"
    >
      <GoogleIcon />
      <Text allowFontScaling style={[styles.googleLabel, { color: palette.foreground }]}>{label}</Text>
    </Pressable>
  )
}

function GoogleIcon() {
  // Decorative. The button it sits in already reads "Continue with Google";
  // labelling the mark as well made VoiceOver announce "Google, Continue with
  // Google".
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.googleIcon} testID="google-icon">
      <Text style={styles.googleIconLetter}>G</Text>
      <View style={[styles.googleAccent, styles.googleAccentRed]} />
      <View style={[styles.googleAccent, styles.googleAccentYellow]} />
      <View style={[styles.googleAccent, styles.googleAccentGreen]} />
    </View>
  )
}

const styles = StyleSheet.create({
  group: { width: '100%', gap: themeTokens.spacing[3] },
  divider: { flexDirection: 'row', alignItems: 'center', gap: themeTokens.spacing[3] },
  dividerRule: { flex: 1, height: StyleSheet.hairlineWidth },
  dividerLabel: { ...textStyles.body },
  // Shared by both providers on purpose: equal size means equal prominence.
  button: { width: '100%', height: themeTokens.touchTarget.minimum },
  buttonBusy: { opacity: 0.72 },
  googleButton: {
    borderWidth: 1,
    borderRadius: themeTokens.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: themeTokens.spacing[5],
    flexDirection: 'row',
    gap: themeTokens.spacing[3],
  },
  googleIcon: { width: 22, height: 22, justifyContent: 'center', alignItems: 'center', position: 'relative' },
  googleIconLetter: { ...textStyles.section, fontWeight: '700' as const, color: '#4285F4' },
  googleAccent: { position: 'absolute', width: 5, height: 3, right: 0, top: 4, borderRadius: 1 },
  googleAccentRed: { backgroundColor: '#EA4335' },
  googleAccentYellow: { backgroundColor: '#FBBC05', right: 1, top: 15 },
  googleAccentGreen: { backgroundColor: '#34A853', left: 1, top: 15 },
  googleLabel: { ...textStyles.bodyStrong, fontWeight: '600' as const },
  error: { ...textStyles.body },
})
