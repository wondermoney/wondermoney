import * as Application from 'expo-application'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, Text, TextInput, useColorScheme, View } from 'react-native'

import { useServerSwitch } from '@/components/providers/server-switch-provider'
import { checkServer, normalizeServerUrl, type ServerCheck } from '@/lib/server/server-connection'
import { themeTokens } from '@/theme/tokens'

import { authFormStyles as styles, FieldError } from './auth-form-styles'

type Props = Readonly<{
  /** Injected for tests; defaults to the installed app's version. */
  appVersion?: string
  fetchImpl?: typeof fetch
}>

/**
 * Lets someone who runs their own WonderMoney server point the app at it. The address is checked
 * against the server's `/v1/instance` before it is saved, so a typo or an incompatible server
 * never replaces a working one.
 */
export function ServerSwitcher({ appVersion = Application.nativeApplicationVersion ?? '0.0.0', fetchImpl }: Props) {
  const { t } = useTranslation()
  const palette = themeTokens.colors[useColorScheme() === 'dark' ? 'dark' : 'light']
  const serverSwitch = useServerSwitch()
  const [editing, setEditing] = useState(false)
  const [address, setAddress] = useState('')
  const [error, setError] = useState<string>()
  const [connecting, setConnecting] = useState(false)

  const errorFor = (check: Exclude<ServerCheck, { status: 'ok' }>): string => {
    if (check.status === 'unreachable') return t('auth.server.errors.unreachable')
    if (check.status === 'update-required') return t('auth.server.errors.updateRequired', { version: check.minAppVersion })
    return t('auth.server.errors.notWonderMoney')
  }

  if (!serverSwitch) return null
  const { apiBaseUrl, switchServer, usesDefaultServer } = serverSwitch

  const connect = async () => {
    const url = normalizeServerUrl(address)
    if (!url) {
      setError(t('auth.server.errors.invalidAddress'))
      return
    }
    setConnecting(true)
    setError(undefined)
    const check = await checkServer(url, { appVersion, ...(fetchImpl ? { fetchImpl } : {}) })
    if (check.status !== 'ok') {
      setError(errorFor(check))
      setConnecting(false)
      return
    }
    await switchServer(url)
  }

  if (!editing) {
    return (
      <View style={{ gap: themeTokens.spacing[1] }}>
        <Text style={[styles.helper, { color: palette.mutedForeground }]}>
          {t('auth.server.current', { host: hostOf(apiBaseUrl) })}
        </Text>
        <Pressable accessibilityRole="button" onPress={() => setEditing(true)}>
          <Text style={{ color: palette.primary }}>{t('auth.server.change')}</Text>
        </Pressable>
        {!usesDefaultServer && (
          <Pressable accessibilityRole="button" onPress={() => { void switchServer(null) }}>
            <Text style={{ color: palette.primary }}>{t('auth.server.useDefault')}</Text>
          </Pressable>
        )}
      </View>
    )
  }

  return (
    <View style={styles.form}>
      <Text style={[styles.label, { color: palette.foreground }]}>{t('auth.server.label')}</Text>
      <TextInput
        accessibilityLabel={t('auth.server.label')}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        onChangeText={setAddress}
        onSubmitEditing={() => { void connect() }}
        placeholder="money.example.com"
        placeholderTextColor={palette.mutedForeground}
        style={[styles.input, { borderColor: palette.border, color: palette.foreground }]}
        value={address}
      />
      {error ? <FieldError color={palette.destructive}>{error}</FieldError> : null}
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ busy: connecting, disabled: connecting }}
        disabled={connecting}
        onPress={() => { void connect() }}
        style={({ pressed }) => [styles.primaryButton, { backgroundColor: palette.primary }, pressed && styles.buttonPressed]}
      >
        <Text style={[styles.buttonLabel, { color: palette.primaryForeground }]}>
          {connecting ? t('auth.server.connecting') : t('auth.server.connect')}
        </Text>
      </Pressable>
      <Pressable accessibilityRole="button" onPress={() => { setEditing(false); setError(undefined) }}>
        <Text style={{ color: palette.primary }}>{t('auth.server.cancel')}</Text>
      </Pressable>
    </View>
  )
}

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}
