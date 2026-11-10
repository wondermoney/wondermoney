import type { EntityMarkCategory, EntityMarkSource } from '@/components/ui/entity-mark'

const TRANSFER_TYPES = new Set(['TRANSFER_IN', 'TRANSFER_OUT'])

/** Whether a server transaction type is one side of a transfer between two accounts. */
export const isTransferType = (type: string | null | undefined): boolean => (
  type ? TRANSFER_TYPES.has(type.trim().toUpperCase()) : false
)

/**
 * A transaction row's lead mark. The opening "Initial balance" row is the
 * account itself, so it shows the institution's logo (a bank glyph without
 * one); a transfer is the arrows; otherwise the category in its own colours,
 * and a muted tag when the row has no category yet.
 */
export function transactionMark(input: Readonly<{
  synthetic?: boolean
  type?: string | null
  /** Already known to be a transfer (the recent-transactions summary says so instead of sending the type). */
  transfer?: boolean
  category?: EntityMarkCategory | null
  institutionLogoUrl?: string | null
}>): EntityMarkSource {
  if (input.synthetic) return { image: input.institutionLogoUrl ?? null, glyph: 'landmark' }
  if (input.transfer || isTransferType(input.type)) return { glyph: 'arrow-left-right' }
  if (input.category) return { icon: input.category }
  return { glyph: 'tag' }
}
