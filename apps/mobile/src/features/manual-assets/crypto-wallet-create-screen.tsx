import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native'

import { Button } from '@/components/ui/button'
import { FormBar } from '@/components/ui/form-bar'
import { FormGroup, FormSelectRow, FormSwitchRow, FormTextRow } from '@/components/ui/form-row'
import { Notice } from '@/components/ui/notice'
import { SafeAreaView } from '@/components/ui/screen-safe-area'
import { Text } from '@/components/ui/text'
import { themeTokens } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'

import { MAX_WALLET_ADDRESSES, type CryptoChain, type CryptoWalletCreateWrite } from './crypto-wallet-contract'
import { buildCryptoWalletCreatePayload, walletSecretIndexes, type CryptoWalletAddressDraft } from './crypto-wallet-forms-model'
import type { CryptoWalletWriteFailure } from './use-crypto-wallet-writes'

type AddressRow = CryptoWalletAddressDraft & Readonly<{ id: number }>

/**
 * Props every address field shares: an address is typed or pasted exactly, so nothing corrects,
 * capitalises or offers to remember it.
 */
export const ADDRESS_INPUT_PROPS = {
  autoCapitalize: 'none',
  autoComplete: 'off',
  autoCorrect: false,
  importantForAutofill: 'no',
  spellCheck: false,
} as const

/**
 * Add crypto wallet, as a calm-structure flow like Add asset: the form bar (close, save), a plain
 * notice that only public addresses are taken, the wallet's name, privacy and notes, then one
 * group per address (chain, address, optional label). Before the request, an address that looks
 * like a private key or a recovery phrase is cleared and nothing is sent; the message is fixed and
 * never repeats what was typed.
 */
export function CryptoWalletCreateScreen({ chains, pending, onBack, onCreate }: Readonly<{
  /** The chains the server reads (`features.cryptoWalletChains`); empty when it reads none. */
  chains: readonly CryptoChain[]
  pending: boolean
  onBack: () => void
  /** Resolves with why it failed, or null once created (the route has moved on). */
  onCreate: (value: CryptoWalletCreateWrite) => Promise<CryptoWalletWriteFailure | null>
}>) {
  const { t } = useTranslation()
  const palette = usePalette()
  const [name, setName] = useState('')
  const [isPrivate, setIsPrivate] = useState(false)
  const [notes, setNotes] = useState('')
  const [nextId, setNextId] = useState(1)
  const [rows, setRows] = useState<readonly AddressRow[]>(() => [{ id: 0, chain: chains[0] ?? null, address: '', label: '' }])
  const [failure, setFailure] = useState<CryptoWalletWriteFailure | null>(null)
  const [blockedRows, setBlockedRows] = useState<ReadonlySet<number>>(new Set())

  if (chains.length === 0) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]}>
        <FormBar closeLabel={t('common.close')} onClose={onBack} title={t('cryptoWallet.create.title')} />
        <View style={styles.state}>
          <Text accessibilityRole="alert" variant="meta">{t('cryptoWallet.failures.feature-disabled')}</Text>
        </View>
      </SafeAreaView>
    )
  }

  const result = buildCryptoWalletCreatePayload({ name, isPrivate, notes, addresses: rows })
  const invalid: ReadonlySet<string> = result.success ? new Set() : result.invalidFields

  const update = (id: number, patch: Partial<CryptoWalletAddressDraft>) => {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)))
    if (patch.address !== undefined) {
      setBlockedRows((current) => (current.has(id) ? new Set([...current].filter((item) => item !== id)) : current))
      setFailure(null)
    }
  }
  const addRow = () => {
    setRows((current) => [...current, { id: nextId, chain: chains[0] ?? null, address: '', label: '' }])
    setNextId((id) => id + 1)
  }
  const removeRow = (id: number) => setRows((current) => current.filter((row) => row.id !== id))
  const clearRows = (indexes: readonly number[]) => {
    const ids = new Set(indexes.map((index) => rows[index]?.id).filter((id): id is number => id !== undefined))
    setRows((current) => current.map((row) => (ids.has(row.id) ? { ...row, address: '' } : row)))
    setBlockedRows(ids)
  }

  const submit = async () => {
    if (!result.success || pending) return
    // The guard runs on what is about to be sent; a secret never reaches onCreate.
    const secrets = walletSecretIndexes(rows)
    if (secrets.length > 0) {
      clearRows(secrets)
      setFailure({ kind: 'secret-rejected', addressIndex: secrets[0] })
      return
    }
    setFailure(null)
    const outcome = await onCreate(result.payload)
    if (!outcome) return
    if (outcome.kind === 'secret-rejected') clearRows(outcome.addressIndex === null ? rows.map((_, index) => index) : [outcome.addressIndex])
    setFailure(outcome)
  }

  const errorFor = (index: number, row: AddressRow): string | null => {
    if (blockedRows.has(row.id)) return t('cryptoWallet.secretBlocked')
    if (failure && failure.addressIndex === index && (failure.kind === 'address-invalid' || failure.kind === 'address-exists')) return t(`cryptoWallet.failures.${failure.kind}`)
    return row.address.trim() !== '' && invalid.has(`addresses.${index}.address`) ? t('cryptoWallet.fieldErrors.address') : null
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]}>
      <FormBar
        closeDisabled={pending}
        closeLabel={t('common.close')}
        onClose={onBack}
        onSave={() => void submit()}
        saveDisabled={!result.success || pending}
        saveLabel={pending ? t('cryptoWallet.create.saving') : t('cryptoWallet.create.save')}
        saving={pending}
        title={t('cryptoWallet.create.title')}
      />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.keyboard}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.page}>
            <Notice message={t('cryptoWallet.publicOnly')} testID="wallet-public-only" />
            <FormGroup>
              <FormTextRow key="name" editable={!pending} label={t('cryptoWallet.create.name')} maxLength={255} onChangeText={setName} placeholder={t('cryptoWallet.create.namePlaceholder')} value={name} />
              <FormSwitchRow key="private" disabled={pending} hint={t('manualAssetCreate.privateDescription')} label={t('cryptoWallet.create.private')} onValueChange={setIsPrivate} value={isPrivate} />
              <FormTextRow key="notes" accessibilityLabel={t('manualAssetCreate.notesOptional')} editable={!pending} label={t('manualAssetCreate.notes')} maxLength={10_000} multiline onChangeText={setNotes} placeholder={t('manualAssetCreate.optional')} value={notes} />
            </FormGroup>
            {rows.map((row, index) => (
              <View key={row.id} style={styles.address} testID={`wallet-address-${index}`}>
                <View style={styles.addressHead}>
                  <Text accessibilityRole="header" variant="metaStrong">{t('cryptoWallet.create.addressHeading', { number: index + 1 })}</Text>
                  {rows.length > 1 ? <Button disabled={pending} label={t('cryptoWallet.create.removeAddress')} accessibilityLabel={t('cryptoWallet.create.removeAddressNumber', { number: index + 1 })} onPress={() => removeRow(row.id)} size="sm" variant="ghost" /> : null}
                </View>
                <AddressFields chains={chains} disabled={pending} error={errorFor(index, row)} number={index + 1} onChange={(patch) => update(row.id, patch)} value={row} />
              </View>
            ))}
            {rows.length < MAX_WALLET_ADDRESSES ? <Button disabled={pending} icon="plus" label={t('cryptoWallet.create.addAddress')} onPress={addRow} style={styles.hug} variant="outline" /> : null}
            {/* An error about one address shows under it; the rest here. */}
            {failure && !(failure.addressIndex !== null && ['address-invalid', 'address-exists', 'secret-rejected'].includes(failure.kind)) ? (
              <Notice message={failure.kind === 'secret-rejected' ? t('cryptoWallet.secretBlocked') : t(`cryptoWallet.failures.${failure.kind}`)} tone="destructive" testID="wallet-create-failure" />
            ) : null}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

/** The chain, address and label of one address: on Add crypto wallet and on Add address. */
export function AddressFields({ chains, value, onChange, error, disabled, number }: {
  chains: readonly CryptoChain[]
  value: CryptoWalletAddressDraft
  onChange: (patch: Partial<CryptoWalletAddressDraft>) => void
  error: string | null
  disabled: boolean
  /** Which address this is on a form with several, for the accessible names. */
  number?: number
}) {
  const { t } = useTranslation()
  const named = (label: string) => (number === undefined ? label : t('cryptoWallet.create.numbered', { label, number }))
  return (
    <FormGroup>
      <FormSelectRow
        key="chain"
        accessibilityLabel={named(t('cryptoWallet.chain'))}
        disabled={disabled}
        label={t('cryptoWallet.chain')}
        onChange={(chain) => onChange({ chain })}
        options={chains.map((chain) => ({ value: chain, label: t(`cryptoWallet.chains.${chain}`) }))}
        placeholder={t('manualAssetCreate.choose')}
        value={value.chain}
      />
      <FormTextRow
        key="address"
        {...ADDRESS_INPUT_PROPS}
        accessibilityLabel={named(t('cryptoWallet.address'))}
        editable={!disabled}
        error={error}
        hint={value.chain === 'bitcoin' ? t('cryptoWallet.addressHints.bitcoin') : value.chain === 'ethereum' ? t('cryptoWallet.addressHints.ethereum') : null}
        label={t('cryptoWallet.address')}
        maxLength={200}
        onChangeText={(address) => onChange({ address })}
        placeholder={value.chain === 'ethereum' ? '0x…' : 'bc1q…'}
        value={value.address}
      />
      <FormTextRow
        key="label"
        accessibilityLabel={named(t('cryptoWallet.labelOptional'))}
        editable={!disabled}
        label={t('cryptoWallet.label')}
        maxLength={100}
        onChangeText={(label) => onChange({ label })}
        placeholder={t('manualAssetCreate.optional')}
        value={value.label}
      />
    </FormGroup>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  keyboard: { flex: 1 },
  content: { flexGrow: 1, paddingHorizontal: themeTokens.layout.screenPadding, paddingBottom: themeTokens.spacing[10] },
  page: { width: '100%', maxWidth: 720, alignSelf: 'center', gap: themeTokens.spacing[4] },
  address: { gap: themeTokens.spacing[2] },
  addressHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: themeTokens.spacing[8] },
  hug: { alignSelf: 'flex-start' },
  state: { flex: 1, alignItems: 'flex-start', padding: themeTokens.layout.screenPadding },
})
