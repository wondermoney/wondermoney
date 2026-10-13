import { Pressable, ScrollView, StyleSheet, Text, useColorScheme, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { themeTokens } from '@/theme/tokens'

export type BootstrapScreenProps = {
  status: 'loading' | 'recoverable-error'
  loadingLabel: string
  errorLabel: string
  retryLabel: string
  onRetry?: () => void
}

export function BootstrapScreen({
  status,
  loadingLabel,
  errorLabel,
  retryLabel,
  onRetry,
}: BootstrapScreenProps) {
  const colorScheme = useColorScheme()
  const palette = themeTokens.colors[colorScheme === 'dark' ? 'dark' : 'light']

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.background }]}>
      <ScrollView testID="bootstrap-scroll" contentContainerStyle={styles.content}>
        {status === 'loading' ? (
          <View
            accessible
            accessibilityLabel={loadingLabel}
            accessibilityRole="progressbar"
            style={styles.state}
          >
            <View accessible={false} style={styles.loadingRuleGroup}>
              <View style={[styles.loadingRule, styles.loadingRuleLong, { backgroundColor: palette.border }]} />
              <View style={[styles.loadingRule, styles.loadingRuleShort, { backgroundColor: palette.border }]} />
              <View style={[styles.loadingRule, styles.loadingRuleMedium, { backgroundColor: palette.border }]} />
            </View>
            <Text allowFontScaling style={[styles.message, { color: palette.mutedForeground }]}>
              {loadingLabel}
            </Text>
          </View>
        ) : (
          <View style={styles.state}>
            <View style={[styles.errorRule, { backgroundColor: palette.destructive }]} />
            <Text
              accessible
              accessibilityLabel={errorLabel}
              accessibilityRole="alert"
              allowFontScaling
              style={[styles.message, { color: palette.foreground }]}
            >
              {errorLabel}
            </Text>
            {onRetry ? (
              <Pressable
                accessibilityRole="button"
                onPress={onRetry}
                style={({ pressed }) => [
                  styles.retry,
                  { borderColor: palette.primary },
                  pressed && styles.pressed,
                ]}
              >
                <Text allowFontScaling style={[styles.retryLabel, { color: palette.primary }]}>
                  {retryLabel}
                </Text>
              </Pressable>
            ) : null}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: themeTokens.layout.screenPadding,
  },
  state: {
    width: '100%',
    maxWidth: 360,
    alignSelf: 'center',
    alignItems: 'flex-start',
    gap: themeTokens.spacing[4],
  },
  loadingRuleGroup: {
    width: 48,
    gap: themeTokens.spacing[2],
  },
  loadingRule: {
    height: 2,
    borderRadius: themeTokens.radius.pill,
  },
  loadingRuleLong: {
    width: 48,
  },
  loadingRuleMedium: {
    width: 36,
  },
  loadingRuleShort: {
    width: 24,
  },
  errorRule: {
    width: 32,
    height: 2,
    borderRadius: themeTokens.radius.pill,
  },
  message: {
    fontFamily: themeTokens.typography.roles.interface.fontFamily,
    fontSize: themeTokens.typography.roles.interface.fontSize,
    lineHeight: themeTokens.typography.roles.interface.lineHeight,
  },
  retry: {
    minWidth: themeTokens.touchTarget.minimum,
    minHeight: themeTokens.touchTarget.minimum,
    justifyContent: 'center',
    paddingHorizontal: themeTokens.spacing[4],
    borderWidth: 1,
    borderRadius: themeTokens.radius.md,
  },
  retryLabel: {
    fontFamily: themeTokens.typography.roles.interface.fontFamily,
    fontSize: themeTokens.typography.roles.interface.fontSize,
    lineHeight: themeTokens.typography.roles.interface.lineHeight,
    fontWeight: '600',
  },
  pressed: {
    opacity: 0.72,
  },
})
