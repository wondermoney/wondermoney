import React, { type ReactElement, type ReactNode } from 'react'
import { Image, StyleSheet, Text } from 'react-native'

import { themeTokens } from '@/theme/tokens'
import { textStyles } from '@/theme/typography'

/** WonderMoney wordmark shown above the auth forms, matching the web app's branded sign-in/sign-up pages. */
export function AuthLogo() {
  return (
    <Image
      accessible={false}
      resizeMode="contain"
      source={require('@/assets/images/wondermoney-logo.png')}
      style={authFormStyles.logo}
    />
  )
}

export function FieldLabel({ children, color }: { children: string; color: string }) {
  return <Text allowFontScaling style={[authFormStyles.label, { color }]}>{children}</Text>
}

export function FieldError({ children, color }: { children: string; color: string }) {
  return <Text accessibilityRole="alert" allowFontScaling style={[authFormStyles.fieldError, { color }]}>{children}</Text>
}

/** Gives auth navigation links a persistent affordance rather than relying on color alone. */
export function AuthFooter({ children }: { children: ReactNode }) {
  const decorate = (node: ReactNode): ReactNode => {
    if (!React.isValidElement(node)) return node
    const element = node as ReactElement<{ children?: ReactNode; style?: unknown }>
    const childNodes = element.props.children
    return React.cloneElement(element, {
      ...(element.type === Text ? { style: [element.props.style, authFormStyles.routeLink] } : {}),
      children: childNodes ? React.Children.map(childNodes, decorate) : childNodes,
    })
  }

  return <>{React.Children.map(children, decorate)}</>
}

export const authFormStyles = StyleSheet.create({
  safeArea: { flex: 1 },
  keyboard: { flex: 1 },
  scrollContent: { flexGrow: 1, justifyContent: 'center', padding: themeTokens.layout.screenPadding },
  panel: { width: '100%', maxWidth: 440, alignSelf: 'center', gap: themeTokens.spacing[6] },
  logo: { width: 128, height: 46 },
  headingGroup: { gap: themeTokens.spacing[2] },
  title: { ...textStyles.title },
  helper: { ...textStyles.body },
  form: { gap: themeTokens.spacing[3] },
  label: { ...textStyles.bodyStrong, marginTop: themeTokens.spacing[1] },
  input: { ...textStyles.body, minHeight: 48, borderWidth: 1, borderRadius: themeTokens.radius.md, paddingHorizontal: themeTokens.spacing[4] },
  fieldError: { ...textStyles.body },
  error: { ...textStyles.body, marginVertical: themeTokens.spacing[1] },
  primaryButton: { minHeight: 48, borderRadius: themeTokens.radius.md, alignItems: 'center', justifyContent: 'center', paddingHorizontal: themeTokens.spacing[5], marginTop: themeTokens.spacing[2] },
  buttonPressed: { opacity: 0.72 },
  buttonLabel: { ...textStyles.bodyStrong, fontWeight: '600' as const },
  routeLink: { textDecorationLine: 'underline' as const, fontWeight: '600' as const },
})
