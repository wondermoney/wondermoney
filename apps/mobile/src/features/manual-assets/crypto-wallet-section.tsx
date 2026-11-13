import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Alert, StyleSheet, Switch, View } from 'react-native'

import { Badge, type BadgeTone } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { FormGroup, FormSwitchRow, FormTextRow } from '@/components/ui/form-row'
import { Notice } from '@/components/ui/notice'
import { Section } from '@/components/ui/section'
import { Sheet } from '@/components/ui/sheet'
import { Text } from '@/components/ui/text'
import { formatRelativeTime } from '@/lib/formatters/relative-time'
import { themeTokens } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'

import { AddressFields } from './crypto-wallet-create-screen'
import type { CryptoChain, CryptoWalletAddressDto, CryptoWalletAddressWrite, CryptoWalletDto, CryptoWalletTokenDto } from './crypto-wallet-contract'
import { buildCryptoWalletAddressPayload, formatTokenQuantity, shortAddress, walletSecretIndexes, type CryptoWalletAddressDraft } from './crypto-wallet-forms-model'
import type { CryptoWalletUpdateWrite, ManualAssetDto } from './manual-assets-contract'
import type { CryptoWalletWriteFailure } from './use-crypto-wallet-writes'

type Outcome = Promise<CryptoWalletWriteFailure | null>

/** What a wallet's page can do; each resolves with why it failed, or null. */
export type CryptoWalletActions = Readonly<{
  /** The chains the server reads now, for Add address. */
  chains: readonly CryptoChain[]
  /** A wallet write is in flight: the controls wait. */
  pending: boolean
  onToggleToken: (tokenId: number, tracked: boolean) => Outcome
  onAddAddress: (value: CryptoWalletAddressWrite) => Outcome
  onSetLabel: (addressId: number, label: string | null) => Outcome
  onRemoveAddress: (addressId: number) => Outcome
  onSyncNow: () => Outcome
  /** Rename the wallet, or change its privacy (the owner only). */
  onUpdateWallet: (value: CryptoWalletUpdateWrite) => Outcome
  /** Remove the wallet; on success the route leaves the page. */
  onDeleteWallet: () => Outcome
}>

const STATUS_TONES: Record<CryptoWalletAddressDto['status'], BadgeTone> = { pending: 'muted', ok: 'outline', failed: 'destructive' }

export const confirmRemove = (title: string, message: string, cancel: string, proceed: string) => new Promise<boolean>((resolve) => {
  Alert.alert(title, message, [
    { text: cancel, style: 'cancel', onPress: () => resolve(false) },
    { text: proceed, style: 'destructive', onPress: () => resolve(true) },
  ], { cancelable: true, onDismiss: () => resolve(false) })
})

/**
 * A crypto wallet's addresses: per address its chain, kind, label, the start and end of the
 * address, how its last read went, and its tokens with a switch each. Only ticked tokens count;
 * a ticked one with no price holds the value at the last one, and the section says so.
 */
export function CryptoWalletSection({ wallet, actions, readOnly }: { wallet: CryptoWalletDto; actions: CryptoWalletActions; readOnly: boolean }) {
  const { t } = useTranslation()
  const [failure, setFailure] = useState<CryptoWalletWriteFailure | null>(null)
  const [queued, setQueued] = useState(false)
  const [adding, setAdding] = useState(false)
  const [labelling, setLabelling] = useState<CryptoWalletAddressDto | null>(null)
  const run = async (action: () => Outcome) => {
    setFailure(null)
    setQueued(false)
    const outcome = await action()
    setFailure(outcome)
    return outcome
  }
  const disabled = readOnly || actions.pending
  const syncedAt = formatRelativeTime(wallet.lastSyncedAt, t)

  return (
    <Section title={t('cryptoWallet.detail.title')} variant="open" testID="wallet-section">
      <View style={styles.intro}>
        <Text tone="muted" variant="meta">{syncedAt ? t('cryptoWallet.detail.lastSynced', { time: syncedAt }) : t('cryptoWallet.detail.neverSynced')}</Text>
        <Text tone="muted" variant="meta">{t('cryptoWallet.detail.tickHint')}</Text>
        {wallet.unpricedSymbols.length > 0 ? (
          <Text accessibilityRole="alert" tone="muted" variant="meta" testID="wallet-unpriced">{t('cryptoWallet.detail.unpriced', { symbols: wallet.unpricedSymbols.join(', ') })}</Text>
        ) : null}
      </View>
      <View style={styles.addresses}>
        {wallet.addresses.map((address) => (
          <AddressBlock
            key={address.cryptoWalletAddressKey}
            address={address}
            canRemove={wallet.addresses.length > 1}
            disabled={disabled}
            readOnly={readOnly}
            onEditLabel={() => setLabelling(address)}
            onRemove={async () => {
              const label = address.label ?? shortAddress(address.address)
              const confirmed = await confirmRemove(t('cryptoWallet.detail.removeTitle'), t('cryptoWallet.detail.removeMessage', { address: label }), t('common.cancel'), t('cryptoWallet.detail.remove'))
              if (confirmed) await run(() => actions.onRemoveAddress(address.cryptoWalletAddressKey))
            }}
            onToggle={(token, tracked) => void run(() => actions.onToggleToken(token.cryptoWalletTokenKey, tracked))}
          />
        ))}
      </View>
      {!readOnly ? (
        <View style={styles.actions}>
          <Button disabled={disabled || actions.chains.length === 0} icon="plus" label={t('cryptoWallet.detail.addAddress')} onPress={() => setAdding(true)} variant="outline" />
          <Button
            disabled={disabled}
            icon="refresh-cw"
            label={t('cryptoWallet.detail.syncNow')}
            onPress={async () => { if ((await run(actions.onSyncNow)) === null) setQueued(true) }}
            variant="outline"
          />
        </View>
      ) : null}
      {queued ? <Text accessibilityRole="alert" tone="muted" variant="meta">{t('cryptoWallet.detail.syncQueued')}</Text> : null}
      {failure ? <Notice message={t(failure.kind === 'secret-rejected' ? 'cryptoWallet.secretBlocked' : `cryptoWallet.failures.${failure.kind}`)} tone="destructive" testID="wallet-failure" /> : null}
      <AddAddressSheet
        chains={actions.chains}
        onAdd={async (value) => {
          setQueued(false)
          const outcome = await actions.onAddAddress(value)
          if (outcome === null) setAdding(false)
          return outcome
        }}
        onClose={() => setAdding(false)}
        pending={actions.pending}
        visible={adding}
      />
      <LabelSheet
        address={labelling}
        onClose={() => setLabelling(null)}
        onSave={async (label) => {
          if (!labelling) return
          const outcome = await run(() => actions.onSetLabel(labelling.cryptoWalletAddressKey, label))
          if (outcome === null) setLabelling(null)
        }}
        pending={actions.pending}
      />
    </Section>
  )
}

function AddressBlock({ address, disabled, readOnly, canRemove, onToggle, onEditLabel, onRemove }: {
  address: CryptoWalletAddressDto
  disabled: boolean
  readOnly: boolean
  canRemove: boolean
  onToggle: (token: CryptoWalletTokenDto, tracked: boolean) => void
  onEditLabel: () => void
  onRemove: () => void
}) {
  const { t, i18n } = useTranslation()
  const palette = usePalette()
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'
  const chain = t(`cryptoWallet.chains.${address.chain}`)
  const kind = t(`cryptoWallet.kinds.${address.kind}`)
  const short = shortAddress(address.address)
  const statusLabel = t(`cryptoWallet.status.${address.status}`)
  const synced = formatRelativeTime(address.lastSyncedAt, t)
  const statusLine = address.status === 'failed'
    ? [t(`cryptoWallet.errors.${address.errorCode ?? 'unknown'}`), synced ? t('cryptoWallet.detail.balancesAsOf', { time: synced }) : null].filter(Boolean).join(' ')
    : address.status === 'ok' && synced
      ? t('cryptoWallet.detail.synced', { time: synced })
      : t('cryptoWallet.detail.pending')
  return (
    <View style={[styles.address, { borderColor: palette.border }]} testID={`wallet-address-${address.cryptoWalletAddressKey}`}>
      <View accessible accessibilityLabel={[address.label, chain, kind, short, statusLabel, statusLine].filter(Boolean).join(', ')} style={styles.addressCopy}>
        <View style={styles.addressHead}>
          <Text style={styles.shrink} variant="bodyStrong">{address.label ?? short}</Text>
          <Badge label={statusLabel} tone={STATUS_TONES[address.status]} />
        </View>
        <Text tone="muted" variant="meta">{[chain, kind, address.label ? short : null].filter(Boolean).join(' · ')}</Text>
        <Text tone={address.status === 'failed' ? 'destructive' : 'muted'} variant="meta">{statusLine}</Text>
      </View>
      {address.tokens.length > 0 ? (
        <View>
          {address.tokens.map((token, index) => (
            <TokenRow key={token.cryptoWalletTokenKey} disabled={disabled} first={index === 0} locale={locale} onToggle={(tracked) => onToggle(token, tracked)} token={token} />
          ))}
        </View>
      ) : null}
      {!readOnly ? (
        <View style={styles.addressActions}>
          <Button disabled={disabled} accessibilityLabel={t('cryptoWallet.detail.editLabelFor', { address: address.label ?? short })} label={t('cryptoWallet.detail.editLabel')} onPress={onEditLabel} size="sm" variant="ghost" />
          {canRemove ? <Button disabled={disabled} accessibilityLabel={t('cryptoWallet.detail.removeFor', { address: address.label ?? short })} label={t('cryptoWallet.detail.remove')} onPress={onRemove} size="sm" variant="ghost" /> : null}
        </View>
      ) : null}
    </View>
  )
}

function TokenRow({ token, locale, disabled, first, onToggle }: { token: CryptoWalletTokenDto; locale: string; disabled: boolean; first: boolean; onToggle: (tracked: boolean) => void }) {
  const { t } = useTranslation()
  const palette = usePalette()
  const quantity = `${formatTokenQuantity(token.quantity, locale)} ${token.symbol}`
  return (
    <View style={[styles.token, { borderTopColor: palette.border }, first && styles.firstToken]}>
      <View style={styles.tokenCopy}>
        <View style={styles.addressHead}>
          <Text variant="amount">{quantity}</Text>
          {token.priceMissing ? <Badge label={t('cryptoWallet.detail.noPrice')} tone="warning" /> : null}
        </View>
        {token.name ? <Text tone="muted" variant="meta">{token.name}</Text> : null}
      </View>
      <Switch
        accessibilityLabel={t('cryptoWallet.detail.countToken', { symbol: token.symbol })}
        accessibilityRole="switch"
        accessibilityState={{ checked: token.tracked, disabled }}
        disabled={disabled}
        onValueChange={onToggle}
        testID={`wallet-token-${token.cryptoWalletTokenKey}`}
        trackColor={{ false: palette.muted, true: palette.primary }}
        value={token.tracked}
      />
    </View>
  )
}

/** Add address, with the same guard as Add crypto wallet: a secret is cleared and never sent. */
function AddAddressSheet({ visible, chains, pending, onClose, onAdd }: {
  visible: boolean
  chains: readonly CryptoChain[]
  pending: boolean
  onClose: () => void
  onAdd: (value: CryptoWalletAddressWrite) => Outcome
}) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState<CryptoWalletAddressDraft>({ chain: chains[0] ?? null, address: '', label: '' })
  const [error, setError] = useState<string | null>(null)
  const [failure, setFailure] = useState<CryptoWalletWriteFailure | null>(null)
  const result = buildCryptoWalletAddressPayload(draft)
  const close = () => {
    setDraft({ chain: chains[0] ?? null, address: '', label: '' })
    setError(null)
    setFailure(null)
    onClose()
  }
  const submit = async () => {
    if (!result.success || pending) return
    if (walletSecretIndexes([draft]).length > 0) {
      setDraft((current) => ({ ...current, address: '' }))
      setError(t('cryptoWallet.secretBlocked'))
      return
    }
    setError(null)
    setFailure(null)
    const outcome = await onAdd(result.payload)
    if (outcome === null) {
      setDraft({ chain: chains[0] ?? null, address: '', label: '' })
      return
    }
    if (outcome.kind === 'secret-rejected') {
      setDraft((current) => ({ ...current, address: '' }))
      setError(t('cryptoWallet.secretBlocked'))
    } else if (outcome.kind === 'address-invalid' || outcome.kind === 'address-exists') {
      setError(t(`cryptoWallet.failures.${outcome.kind}`))
    } else {
      setFailure(outcome)
    }
  }
  return (
    <Sheet
      closeLabel={t('common.close')}
      footer={<Button disabled={!result.success || pending} label={pending ? t('cryptoWallet.detail.adding') : t('cryptoWallet.detail.addAddress')} loading={pending} onPress={submit} />}
      onClose={close}
      testID="wallet-add-address"
      title={t('cryptoWallet.detail.addAddress')}
      visible={visible}
    >
      <View style={styles.sheet}>
        <Notice message={t('cryptoWallet.publicOnly')} />
        <AddressFields
          chains={chains}
          disabled={pending}
          error={error}
          onChange={(patch) => {
            setDraft((current) => ({ ...current, ...patch }))
            if (patch.address !== undefined) setError(null)
          }}
          value={draft}
        />
        {failure ? <Notice message={t(`cryptoWallet.failures.${failure.kind}`)} tone="destructive" /> : null}
      </View>
    </Sheet>
  )
}

function LabelSheet({ address, pending, onClose, onSave }: { address: CryptoWalletAddressDto | null; pending: boolean; onClose: () => void; onSave: (label: string | null) => Promise<void> }) {
  const { t } = useTranslation()
  const [label, setLabel] = useState<string | null>(null)
  const value = label ?? address?.label ?? ''
  const close = () => { setLabel(null); onClose() }
  return (
    <Sheet
      closeLabel={t('common.close')}
      footer={<Button disabled={pending} label={t('cryptoWallet.detail.saveLabel')} loading={pending} onPress={async () => { await onSave(value.trim() === '' ? null : value.trim()); setLabel(null) }} />}
      onClose={close}
      title={t('cryptoWallet.detail.editLabel')}
      visible={address !== null}
    >
      <View style={styles.sheet}>
        {address ? <Text tone="muted" variant="meta">{shortAddress(address.address)}</Text> : null}
        <FormGroup>
          <FormTextRow accessibilityLabel={t('cryptoWallet.labelOptional')} editable={!pending} label={t('cryptoWallet.label')} maxLength={100} onChangeText={setLabel} placeholder={t('manualAssetCreate.optional')} value={value} />
        </FormGroup>
      </View>
    </Sheet>
  )
}

/**
 * Edit wallet (its name, and its privacy for the owner) and Remove wallet, with a confirmation
 * first. Kind, value and valuations are not editable on a wallet: the sync values it.
 */
export function CryptoWalletManage({ asset, actions }: { asset: Pick<ManualAssetDto, 'name' | 'isPrivate' | 'isOwner'>; actions: CryptoWalletActions }) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState<string | null>(null)
  const [isPrivate, setIsPrivate] = useState<boolean | null>(null)
  const [failure, setFailure] = useState<CryptoWalletWriteFailure | null>(null)
  const shownName = name ?? asset.name
  const shownPrivate = isPrivate ?? asset.isPrivate
  const change: CryptoWalletUpdateWrite = {
    ...(shownName.trim() !== asset.name ? { name: shownName.trim() } : {}),
    ...(asset.isOwner && shownPrivate !== asset.isPrivate ? { isPrivate: shownPrivate } : {}),
  }
  const changed = Object.keys(change).length > 0
  const nameValid = shownName.trim().length > 0
  const close = () => { setEditing(false); setName(null); setIsPrivate(null) }
  const save = async () => {
    if (!changed || !nameValid || actions.pending) return
    setFailure(null)
    const outcome = await actions.onUpdateWallet(change)
    if (outcome === null) close()
    else setFailure(outcome)
  }
  const remove = async () => {
    setFailure(null)
    const confirmed = await confirmRemove(t('cryptoWallet.manage.removeTitle'), t('cryptoWallet.manage.removeMessage', { name: asset.name }), t('common.cancel'), t('cryptoWallet.manage.remove'))
    if (!confirmed) return
    setFailure(await actions.onDeleteWallet())
  }
  return (
    <View style={styles.manage} testID="wallet-manage">
      <View style={styles.actions}>
        <Button disabled={actions.pending} icon="pencil" label={t('cryptoWallet.manage.edit')} onPress={() => setEditing(true)} variant="outline" />
        <Button disabled={actions.pending} icon="trash" label={t('cryptoWallet.manage.remove')} onPress={remove} variant="outline" />
      </View>
      {failure && !editing ? <Notice message={t(`cryptoWallet.failures.${failure.kind}`)} tone="destructive" /> : null}
      <Sheet
        closeLabel={t('common.close')}
        footer={<Button disabled={!changed || !nameValid || actions.pending} label={t('cryptoWallet.manage.save')} loading={actions.pending} onPress={save} />}
        onClose={close}
        testID="wallet-edit"
        title={t('cryptoWallet.manage.editTitle')}
        visible={editing}
      >
        <View style={styles.sheet}>
          <FormGroup>
            <FormTextRow editable={!actions.pending} error={nameValid ? null : t('cryptoWallet.fieldErrors.name')} label={t('cryptoWallet.create.name')} maxLength={255} onChangeText={setName} value={shownName} />
            {/* Only the owner decides who sees it. */}
            {asset.isOwner ? <FormSwitchRow disabled={actions.pending} hint={t('manualAssetCreate.privateDescription')} label={t('cryptoWallet.create.private')} onValueChange={setIsPrivate} value={shownPrivate} /> : null}
          </FormGroup>
          {failure ? <Notice message={t(`cryptoWallet.failures.${failure.kind}`)} tone="destructive" /> : null}
        </View>
      </Sheet>
    </View>
  )
}

const styles = StyleSheet.create({
  intro: { gap: themeTokens.spacing[1] },
  addresses: { gap: themeTokens.spacing[3] },
  address: { borderWidth: 1, borderRadius: themeTokens.radius.lg, padding: themeTokens.spacing[4], gap: themeTokens.spacing[3] },
  addressCopy: { gap: themeTokens.spacing[1] },
  addressHead: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: themeTokens.spacing[2] },
  addressActions: { flexDirection: 'row', gap: themeTokens.spacing[2] },
  shrink: { flexShrink: 1 },
  token: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: themeTokens.spacing[4], paddingVertical: themeTokens.spacing[3], borderTopWidth: StyleSheet.hairlineWidth },
  firstToken: { paddingTop: themeTokens.spacing[3] },
  tokenCopy: { flexShrink: 1, gap: themeTokens.spacing[1] },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: themeTokens.spacing[2] },
  sheet: { gap: themeTokens.spacing[4] },
  manage: { gap: themeTokens.spacing[3], marginTop: themeTokens.spacing[4] },
})
