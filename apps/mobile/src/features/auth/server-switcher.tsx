import * as Application from 'expo-application'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { StyleSheet, useColorScheme, View } from 'react-native'

import { Button } from '@/components/ui/button'
import { Text } from '@/components/ui/text'

import { useServerSwitch } from '@/components/providers/server-switch-provider'
import { checkServer, normalizeServerUrl, type ServerCheck } from '@/lib/server/server-connection'
import { themeTokens } from '@/theme/tokens'

import { AuthField, AuthLink, AuthTextInput } from './auth-form-styles'

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

  // Mobile-only (web is served from the server it talks to): a quiet line under the
  // form, the host in mono, the actions as web-style links.
  if (!editing) {
    return (
      <View style={[localStyles.block, { borderTopColor: palette.border }]}>
        <Text tone="muted" variant="label">{t('auth.server.current', { host: hostOf(apiBaseUrl) })}</Text>
        <View style={localStyles.links}>
          <AuthLink label={t('auth.server.change')} onPress={() => setEditing(true)} />
          {!usesDefaultServer && (
            <AuthLink label={t('auth.server.useDefault')} onPress={() => { void switchServer(null) }} />
          )}
        </View>
      </View>
    )
  }

  return (
    <View style={[localStyles.block, { borderTopColor: palette.border }]}>
      <AuthField error={error} label={t('auth.server.label')}>
        <AuthTextInput
          accessibilityLabel={t('auth.server.label')}
          autoCapitalize="none"
          autoCorrect={false}
          invalid={Boolean(error)}
          keyboardType="url"
          onChangeText={setAddress}
          onSubmitEditing={() => { void connect() }}
          placeholder="money.example.com"
          value={address}
        />
      </AuthField>
      <View style={localStyles.actions}>
        <Button
          disabled={connecting}
          label={connecting ? t('auth.server.connecting') : t('auth.server.connect')}
          loading={connecting}
          onPress={() => { void connect() }}
          variant="outline"
        />
        <Button label={t('auth.server.cancel')} onPress={() => { setEditing(false); setError(undefined) }} variant="ghost" />
      </View>
    </View>
  )
}

const localStyles = StyleSheet.create({
  block: { gap: themeTokens.spacing[3], borderTopWidth: 1, paddingTop: themeTokens.spacing[4] },
  links: { flexDirection: 'row', flexWrap: 'wrap', columnGap: themeTokens.spacing[4], rowGap: themeTokens.spacing[2] },
  actions: { flexDirection: 'row', gap: themeTokens.spacing[2] },
})

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}
