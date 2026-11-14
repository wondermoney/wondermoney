import { useTranslation } from 'react-i18next'
import { Alert, StyleSheet, View } from 'react-native'

import { Button } from '@/components/ui/button'
import { Text } from '@/components/ui/text'
import { SettingsNotice, SettingsSection } from '@/features/more/settings-ui'
import type { PasskeySummary } from '@/lib/auth/app-auth'
import { passkeyLabel } from '@/lib/auth/passkey-label'
import { formatTransactionDate } from '@/lib/dates/transaction-date'
import { themeTokens } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'

export type PasskeysSectionStatus = 'loading' | 'error' | 'ready'
export type PasskeyAddFailure = 'session-not-fresh' | 'unavailable'
/** The last action's result, shown under the list until the next one. */
export type PasskeysNotice = 'added' | 'deleted' | 'add-failed' | 'session-not-fresh' | 'delete-failed'

export type PasskeysSectionProps = Readonly<{
  status: PasskeysSectionStatus
  passkeys: readonly PasskeySummary[]
  /**
   * Whether this phone can create one for this server (`usePasskeyAvailable`). The list and
   * Delete work everywhere; Add only where the device will hand the app the server's passkeys.
   */
  canAdd: boolean
  adding: boolean
  /** The passkey whose deletion is in flight. */
  deletingId: string | null
  notice: PasskeysNotice | null
  locale: string
  onRetry: () => void
  onAdd: () => void | Promise<void>
  onDelete: (id: string) => void | Promise<void>
}>

const NOTICE_KEYS: Record<PasskeysNotice, { key: string; tone: 'default' | 'destructive' }> = {
  added: { key: 'security.passkeys.added', tone: 'default' },
  deleted: { key: 'security.passkeys.deleted', tone: 'default' },
  'add-failed': { key: 'security.passkeys.errors.add', tone: 'destructive' },
  'session-not-fresh': { key: 'security.passkeys.errors.sessionNotFresh', tone: 'destructive' },
  'delete-failed': { key: 'security.passkeys.errors.delete', tone: 'destructive' },
}

/**
 * Settings, Security, Passkeys: web's section at phone width. Each passkey with its name (or its
 * password manager's), when it was added and last used, and Delete behind a confirmation. Web's
 * Rename stays on the web app.
 */
export function PasskeysSection({
  status,
  passkeys,
  canAdd,
  adding,
  deletingId,
  notice,
  locale,
  onRetry,
  onAdd,
  onDelete,
}: PasskeysSectionProps) {
  const { t } = useTranslation()
  const palette = usePalette()
  const label = (passkey: PasskeySummary) => passkeyLabel(passkey) ?? t('security.passkeys.defaultName')
  const date = (value: string) => formatTransactionDate(value, locale)

  const confirmDelete = (passkey: PasskeySummary) => {
    const name = label(passkey)
    Alert.alert(
      t('security.passkeys.deleteTitle'),
      t('security.passkeys.deleteDescription', { name }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('security.passkeys.deleteConfirm'), style: 'destructive', onPress: () => void onDelete(passkey.id) },
      ],
      { cancelable: true },
    )
  }

  const shownNotice = notice ? NOTICE_KEYS[notice] : null

  return (
    <SettingsSection title={t('security.passkeys.heading')} description={t('security.passkeys.helper')}>
      {status === 'loading' ? (
        <Text accessibilityLabel={t('security.passkeys.loading')} accessibilityRole="progressbar" tone="muted" variant="meta">
          {t('security.passkeys.loading')}
        </Text>
      ) : null}

      {status === 'error' ? (
        <View style={styles.row}>
          <Text accessibilityRole="alert" tone="destructive" variant="meta">{t('security.passkeys.loadFailed')}</Text>
          <Button label={t('security.passkeys.retry')} onPress={onRetry} variant="outline" />
        </View>
      ) : null}

      {status === 'ready' && passkeys.length === 0 ? (
        <Text tone="muted" variant="meta">{t('security.passkeys.empty')}</Text>
      ) : null}

      {status === 'ready' && passkeys.length > 0 ? (
        <View>
          {passkeys.map((passkey, index) => (
            <View
              key={passkey.id}
              style={[styles.item, index > 0 && { borderTopColor: palette.border, borderTopWidth: StyleSheet.hairlineWidth }]}
              testID={`passkey-${passkey.id}`}
            >
              <View style={styles.details}>
                <Text variant="metaStrong">{label(passkey)}</Text>
                {passkey.createdAt ? (
                  <Text tone="muted" variant="meta">{t('security.passkeys.addedOn', { date: date(passkey.createdAt) })}</Text>
                ) : null}
                <Text tone="muted" variant="meta">
                  {passkey.lastUsedAt
                    ? t('security.passkeys.lastUsed', { date: date(passkey.lastUsedAt) })
                    : t('security.passkeys.neverUsed')}
                </Text>
              </View>
              <Button
                accessibilityLabel={t('security.passkeys.deleteNamed', { name: label(passkey) })}
                disabled={deletingId !== null}
                label={t('security.passkeys.delete')}
                loading={deletingId === passkey.id}
                onPress={() => confirmDelete(passkey)}
                size="sm"
                variant="destructive"
              />
            </View>
          ))}
        </View>
      ) : null}

      {shownNotice ? <SettingsNotice alert={shownNotice.tone === 'destructive'} message={t(shownNotice.key)} tone={shownNotice.tone} /> : null}

      {canAdd ? (
        <Button
          disabled={adding}
          label={adding ? t('security.passkeys.adding') : t('security.passkeys.add')}
          loading={adding}
          onPress={() => void onAdd()}
        />
      ) : (
        <Text tone="muted" variant="meta">{t('security.passkeys.unsupported')}</Text>
      )}
    </SettingsSection>
  )
}

const styles = StyleSheet.create({
  row: { gap: themeTokens.spacing[3], alignItems: 'flex-start' },
  // Web: one row per passkey, its details beside the Delete button, hairline dividers.
  item: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: themeTokens.spacing[3],
    paddingVertical: themeTokens.spacing[4],
    minHeight: themeTokens.touchTarget.minimum,
  },
  details: { flex: 1, gap: themeTokens.spacing[1] },
})
