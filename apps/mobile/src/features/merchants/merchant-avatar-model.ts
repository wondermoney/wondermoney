import { merchantAvatarColors, type ColorScheme, type MerchantAvatarColors } from '@/theme/tokens'

/**
 * The merchant avatar's fallback: one initial on a colour derived from the merchant's name.
 * Web (`apps/web/lib/merchant/merchant-avatar.ts`) runs the same algorithm over the same palette
 * order, so a merchant has the same colour in every client. Change it on both or neither.
 */

/** The API's `normalizeMerchantName`: accents dropped, spaces collapsed, lower case. */
export function normalizeMerchantName(name: string): string {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().replace(/\s+/g, ' ').toLowerCase()
}

/** FNV-1a, 32-bit, over the UTF-16 code units of `value`. */
function fnv1a(value: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash
}

/** The palette slot for a merchant: the same for every spelling that normalizes alike. */
export function merchantColorIndex(name: string, paletteSize: number = merchantAvatarColors.light.length): number {
  return fnv1a(normalizeMerchantName(name)) % paletteSize
}

/** The merchant's first letter or digit, upper-cased; `?` when the name has none. */
export function merchantInitial(name: string): string {
  const match = /[\p{L}\p{N}]/u.exec(name)
  return match ? match[0].toLocaleUpperCase() : '?'
}

/** The fill and ink for a merchant's initial in one theme half. */
export function merchantAvatarColorsFor(name: string, scheme: ColorScheme): MerchantAvatarColors {
  const palette = merchantAvatarColors[scheme]
  return palette[merchantColorIndex(name, palette.length)]!
}
