import { looksLikeWalletSecret } from '@wondermoney/shared/crypto-wallet'

import type { FormResult } from './asset-forms-model'
import {
  cryptoWalletAddressWriteSchema,
  cryptoWalletCreateWriteSchema,
  type CryptoChain,
  type CryptoWalletAddressWrite,
  type CryptoWalletCreateWrite,
} from './crypto-wallet-contract'

export type CryptoWalletAddressDraft = Readonly<{ chain: CryptoChain | null; address: string; label: string }>

export type CryptoWalletCreateDraft = Readonly<{
  name: string
  isPrivate: boolean
  notes: string
  addresses: readonly CryptoWalletAddressDraft[]
}>

/** `name`, or an address row's own field as `addresses.<index>.<field>`. */
export type CryptoWalletCreateField = 'name' | `addresses.${number}.${'chain' | 'address' | 'label'}`
export type CryptoWalletAddressField = 'chain' | 'address' | 'label'

/**
 * The indexes of the addresses that look like a private key or a recovery phrase. Run before
 * anything is sent: such an address is cleared from the form and never leaves the device.
 */
export function walletSecretIndexes(addresses: readonly { address: string }[]): number[] {
  return addresses.flatMap((row, index) => (looksLikeWalletSecret(row.address) === null ? [] : [index]))
}

function addressPayload(draft: CryptoWalletAddressDraft): CryptoWalletAddressWrite {
  const label = draft.label.trim()
  return { chain: draft.chain ?? ('' as CryptoChain), address: draft.address.trim(), ...(label ? { label } : {}) }
}

/**
 * Add crypto wallet: the name, privacy, notes and one or more addresses, each on a chain. An
 * empty optional field is left out. This only checks the shape; telling an address from a secret
 * is `walletSecretIndexes`, and whether an address is real is the API's to say.
 */
export function buildCryptoWalletCreatePayload(draft: CryptoWalletCreateDraft): FormResult<CryptoWalletCreateWrite, CryptoWalletCreateField> {
  const invalidFields = new Set<CryptoWalletCreateField>()
  const notes = draft.notes.trim()
  const payload: CryptoWalletCreateWrite = {
    name: draft.name.trim(),
    isPrivate: draft.isPrivate,
    ...(notes ? { notes } : {}),
    addresses: draft.addresses.map(addressPayload),
  }
  const parsed = cryptoWalletCreateWriteSchema.safeParse(payload)
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const [head, index, field] = issue.path
      if (head === 'name') invalidFields.add('name')
      if (head === 'addresses' && typeof index === 'number' && (field === 'chain' || field === 'address' || field === 'label')) invalidFields.add(`addresses.${index}.${field}`)
    }
  }
  if (invalidFields.size > 0 || !parsed.success) return { success: false, invalidFields }
  return { success: true, payload: parsed.data }
}

/** Add address on a wallet's page: one address on a chain, with an optional label. */
export function buildCryptoWalletAddressPayload(draft: CryptoWalletAddressDraft): FormResult<CryptoWalletAddressWrite, CryptoWalletAddressField> {
  const invalidFields = new Set<CryptoWalletAddressField>()
  const parsed = cryptoWalletAddressWriteSchema.safeParse(addressPayload(draft))
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const field = issue.path[0]
      if (field === 'chain' || field === 'address' || field === 'label') invalidFields.add(field)
    }
  }
  if (invalidFields.size > 0 || !parsed.success) return { success: false, invalidFields }
  return { success: true, payload: parsed.data }
}

/** "bc1qar0s…5mdq": the start and end of a long address, the whole of a short one. */
export function shortAddress(address: string): string {
  return address.length <= 16 ? address : `${address.slice(0, 8)}…${address.slice(-4)}`
}

/**
 * An exact decimal string ("1234.01234567") in the reader's language ("1.234,01234567" in pt),
 * without going through a float: every digit the API sent is kept.
 */
export function formatTokenQuantity(quantity: string, locale: string): string {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(quantity)
  if (!match) return quantity
  const [, sign, whole, fraction] = match
  let decimal = '.'
  let group = ','
  try {
    for (const part of new Intl.NumberFormat(locale, { useGrouping: true }).formatToParts(10000.5)) {
      if (part.type === 'decimal') decimal = part.value
      if (part.type === 'group') group = part.value
    }
  } catch {
    // An unsupported locale keeps the English separators.
  }
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, group)
  return `${sign}${grouped}${fraction ? `${decimal}${fraction}` : ''}`
}
