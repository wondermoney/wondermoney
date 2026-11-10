import React, { useState, type ReactElement, type ReactNode } from 'react'
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text as RNText,
  TextInput,
  useColorScheme,
  View,
  type TextInputProps,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { Text } from '@/components/ui/text'
import { themeTokens } from '@/theme/tokens'
import { textStyles } from '@/theme/typography'
import { usePalette } from '@/theme/use-palette'

/**
 * The web auth pages at phone width (`app/[locale]/(no-layout)/auth/{login,signup,forgot,reset}`):
 * a muted canvas, the column centred (`px-6 py-12`, `max-w-lg`), the 146x54 wordmark, a
 * 24/36 bold title `mt-8`, a 14px muted line with an underlined primary link `mt-2`, then
 * the form `mt-10` with 24pt between fields.
 */

/** WonderMoney wordmark, one asset per theme as web's `Logo` (each matches that mode's primary). */
export function AuthLogo() {
  const dark = useColorScheme() === 'dark'
  return (
    <Image
      accessible={false}
      resizeMode="contain"
      source={dark
        ? require('@/assets/images/wondermoney-logo-dark.png')
        : require('@/assets/images/wondermoney-logo.png')}
      style={authFormStyles.logo}
    />
  )
}

export function AuthLayout({ title, lead, eyebrow, notice, children, footer }: {
  title: string
  /** Web's muted line under the title ("Not a member? Create an account"). */
  lead?: ReactNode
  /** A line above the title (a household-invite greeting). */
  eyebrow?: string
  /** A message the route brings with it (link expired, password updated). */
  notice?: ReactNode
  children: ReactNode
  footer?: ReactNode
}) {
  const palette = usePalette()
  return (
    <SafeAreaView style={[authFormStyles.safeArea, { backgroundColor: palette.muted }]}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={authFormStyles.keyboard}>
        <ScrollView contentContainerStyle={authFormStyles.scrollContent} keyboardShouldPersistTaps="handled">
          <View style={authFormStyles.panel}>
            <AuthLogo />
            <View style={authFormStyles.headingGroup}>
              {eyebrow ? <Text tone="primary" variant="metaStrong">{eyebrow}</Text> : null}
              <Text accessibilityRole="header" style={authFormStyles.title} variant="title">{title}</Text>
              {lead ? <View>{lead}</View> : null}
            </View>
            {notice}
            <View style={authFormStyles.form}>{children}</View>
            {footer ? <View style={authFormStyles.footer}>{footer}</View> : null}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

/** "Not a member? **Create an account**": muted 14px with the link inline (web `t.rich`). */
export function AuthLead({ text, link }: { text?: string; link?: ReactNode }) {
  return (
    <View style={authFormStyles.subtitleRow}>
      {text ? <Text tone="muted" variant="meta">{text}</Text> : null}
      {link}
    </View>
  )
}

/**
 * Web's auth link: primary 14px, underlined (`underline underline-offset-2`), semibold when
 * it sits in running text. A 44pt target through `hitSlop`.
 */
export function AuthLink({ label, onPress, strong = false, accessibilityLabel }: {
  label: string
  /** Optional so an expo-router `<Link asChild>` can supply it. */
  onPress?: () => void
  strong?: boolean
  accessibilityLabel?: string
}) {
  const palette = usePalette()
  const [focused, setFocused] = useState(false)
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityRole="link"
      hitSlop={12}
      onBlur={() => setFocused(false)}
      onFocus={() => setFocused(true)}
      onPress={onPress}
      style={({ pressed }) => [
        authFormStyles.link,
        focused && { borderColor: palette.ring, borderWidth: 2 },
        pressed && authFormStyles.buttonPressed,
      ]}
    >
      <Text style={[authFormStyles.linkText, strong && authFormStyles.linkStrong]} tone="primary" variant="meta">{label}</Text>
    </Pressable>
  )
}

/** Label above, input, error under it (web `FormItem`: `FormLabel`, `Input`, `FormMessage`). */
export function AuthField({ label, error, required = false, children }: {
  label: string
  error?: string
  required?: boolean
  children: ReactNode
}) {
  return (
    <View style={authFormStyles.field}>
      <Text variant="metaStrong">{required ? `${label} *` : label}</Text>
      {children}
      {error ? <FieldError>{error}</FieldError> : null}
    </View>
  )
}

/**
 * Web's auth `Input` (`className="bg-card"`): 40pt, input border, 6pt radius, `px-4`, 14px,
 * placeholder in muted ink, a 2pt ring when focused, a destructive border when invalid.
 */
export function AuthTextInput({ invalid = false, style, onFocus, onBlur, editable, ...rest }: TextInputProps & { invalid?: boolean }) {
  const palette = usePalette()
  const [focused, setFocused] = useState(false)
  return (
    <TextInput
      allowFontScaling
      editable={editable}
      onBlur={(event) => { setFocused(false); onBlur?.(event) }}
      onFocus={(event) => { setFocused(true); onFocus?.(event) }}
      placeholderTextColor={palette.mutedForeground}
      {...rest}
      style={[
        authFormStyles.input,
        {
          color: palette.foreground,
          backgroundColor: editable === false ? palette.muted : palette.card,
          borderColor: focused ? palette.ring : invalid ? palette.destructiveText : palette.input,
          borderWidth: focused ? 2 : 1,
          paddingHorizontal: focused ? themeTokens.spacing[4] - 1 : themeTokens.spacing[4],
        },
        style,
      ]}
    />
  )
}

/** Web's "Or continue with": a hairline with the words centred on the canvas. */
export function AuthDivider({ label }: { label: string }) {
  const palette = usePalette()
  return (
    <View style={authFormStyles.divider}>
      <View style={[authFormStyles.dividerRule, { backgroundColor: palette.border }]} />
      <Text tone="muted" variant="metaStrong">{label}</Text>
      <View style={[authFormStyles.dividerRule, { backgroundColor: palette.border }]} />
    </View>
  )
}

/** A route-level message above the form: hairline box, `-text` ink for an error. */
export function AuthNotice({ message, tone = 'default' }: { message: string; tone?: 'default' | 'destructive' }) {
  const palette = usePalette()
  return (
    <View style={[authFormStyles.notice, { borderColor: tone === 'destructive' ? palette.destructiveText : palette.border, backgroundColor: palette.card }]}>
      <Text accessibilityLabel={message} accessibilityRole="alert" accessible tone={tone === 'destructive' ? 'destructive' : 'default'} variant="meta">
        {message}
      </Text>
    </View>
  )
}

/** @deprecated use `AuthField`'s `label`. Kept for the MFA and server forms. */
export function FieldLabel({ children, color }: { children: string; color?: string }) {
  return <Text style={color ? { color } : undefined} variant="metaStrong">{children}</Text>
}

export function FieldError({ children }: { children: string; color?: string }) {
  return <Text accessibilityRole="alert" tone="destructive" variant="meta">{children}</Text>
}

/** Gives auth navigation links a persistent affordance rather than relying on color alone. */
export function AuthFooter({ children }: { children: ReactNode }) {
  const decorate = (node: ReactNode): ReactNode => {
    if (!React.isValidElement(node)) return node
    const element = node as ReactElement<{ children?: ReactNode; style?: unknown }>
    const childNodes = element.props.children
    return React.cloneElement(element, {
      ...(element.type === RNText ? { style: [element.props.style, authFormStyles.routeLink] } : {}),
      children: childNodes ? React.Children.map(childNodes, decorate) : childNodes,
    })
  }

  return <>{React.Children.map(children, decorate)}</>
}

export const authFormStyles = StyleSheet.create({
  safeArea: { flex: 1 },
  keyboard: { flex: 1 },
  // Web centres the column in the viewport (`min-h-dvh justify-center`). Mobile's
  // sign-in carries Apple and the server rows too, so web's 48pt vertical padding
  // left it taller than the screen and the column sat at the top: 24pt keeps it
  // centred, and the ScrollView still scrolls when the keyboard takes the room.
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: themeTokens.spacing[6],
    paddingVertical: themeTokens.spacing[6],
  },
  panel: { width: '100%', maxWidth: 512, alignSelf: 'center', gap: themeTokens.spacing[8] },
  logo: { width: 146, height: 54 },
  headingGroup: { gap: themeTokens.spacing[2] },
  title: { fontWeight: '700', lineHeight: 36 },
    subtitleRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: themeTokens.spacing[1] },
  form: { gap: themeTokens.spacing[6], marginTop: themeTokens.spacing[2] },
  footer: { gap: themeTokens.spacing[4] },
  field: { gap: themeTokens.spacing[2] },
  helper: { ...textStyles.meta },
  label: { ...textStyles.metaStrong },
  input: {
    ...textStyles.meta,
    minHeight: themeTokens.size.control,
    borderRadius: themeTokens.radius.md,
    paddingVertical: themeTokens.spacing[2],
  },
  error: { ...textStyles.meta },
  primaryButton: {
    minHeight: themeTokens.size.control,
    borderRadius: themeTokens.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: themeTokens.spacing[4],
  },
  buttonPressed: { opacity: 0.72 },
  buttonLabel: { ...textStyles.action, fontWeight: '600' },
  link: { alignSelf: 'flex-start', borderRadius: themeTokens.radius.sm, borderWidth: 2, borderColor: 'transparent' },
  linkText: { textDecorationLine: 'underline' },
  linkStrong: { fontWeight: '600' },
  routeLink: { textDecorationLine: 'underline', fontWeight: '600' },
  divider: { flexDirection: 'row', alignItems: 'center', gap: themeTokens.spacing[4] },
  dividerRule: { flex: 1, height: 1 },
  notice: { borderWidth: 1, borderRadius: themeTokens.radius.md, padding: themeTokens.spacing[4] },
})
