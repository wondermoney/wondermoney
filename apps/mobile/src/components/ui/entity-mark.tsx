import { Image } from 'expo-image'
import { useState } from 'react'
import { StyleSheet, View } from 'react-native'

import { CategoryIcon } from '@/components/ui/category-icon'
import { Icon, type IconName } from '@/components/ui/icon'
import { Text } from '@/components/ui/text'
import { themeTokens } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'

export type EntityMarkSize = 'md' | 'sm'

/** A category's own swatch: its icon name and its bg/text colours (hex from the API). */
export type EntityMarkCategory = Readonly<{
  name: string | null | undefined
  bgColor?: string | null
  textColor?: string | null
}>

/**
 * What a mark shows. Pass any of these; the first one that can draw wins, in
 * this order: `image` (until it fails to load), `icon`, `initials`, `glyph`.
 * So `{ image, initials }` is a logo that falls back to letters, and
 * `{ image, glyph }` a logo that falls back to a glyph.
 */
export type EntityMarkSource = Readonly<{
  /** A third-party logo URL, drawn on a forced white backing. */
  image?: string | null
  /** A category's icon on the category's colours. */
  icon?: EntityMarkCategory | null
  /** Text whose first two letters show, in mono, on the muted surface. */
  initials?: string | null
  /** An `Icon` on the muted surface. */
  glyph?: IconName | null
}>

export type EntityMarkProps = EntityMarkSource & {
  /** `md` 36pt for list rows (default), `sm` 24pt for dense rows, sheets and form values. */
  size?: EntityMarkSize
  testID?: string
}

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/
const safeColor = (value: string | null | undefined): string | null => (value && HEX.test(value) ? value : null)
/** Ink that reads on a category colour when the category only has a background (the categories list's rule). */
function contrastingInk(background: string): string {
  const hex = background.length === 4 ? background.slice(1).split('').map((digit) => digit + digit).join('') : background.slice(1, 7)
  const [red, green, blue] = [0, 2, 4].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16)) as [number, number, number]
  return (red * 299 + green * 587 + blue * 114) / 1000 > 145 ? themeTokens.colors.light.foreground : themeTokens.colors.dark.foreground
}

const isLogoUrl = (value: string | null | undefined): value is string => typeof value === 'string' && /^https?:\/\/\S+$/i.test(value.trim())

/**
 * The letters a mark shows: the first letter of each of the first two words
 * ("Caixa Geral" → "CG"), or a single word's first two ("AAPL.US" → "AA",
 * web's `symbol.slice(0, 2)`). `null` when nothing letter-like is left.
 */
export function markInitials(text: string | null | undefined): string | null {
  if (!text) return null
  const words = text.trim().split(/\s+/).map((word) => word.replace(/[^\p{L}\p{N}]/gu, '')).filter(Boolean)
  if (words.length === 0) return null
  const letters = words.length > 1 ? `${[...words[0]!][0]}${[...words[1]!][0]}` : [...words[0]!].slice(0, 2).join('')
  return letters.toLocaleUpperCase()
}

/**
 * The one leading mark for a row that names a thing: a category, an account's
 * institution, a ticker, a portfolio. Web's `FinancialAssetLogo` is the model:
 * a logo sits on white with a hairline so it stays legible in dark mode, a
 * logo that is missing or fails to load falls back (to letters, then a glyph),
 * and a column of marks never has gaps. Decorative: the row's own label names
 * the thing, so the mark is hidden from screen readers.
 */
export function EntityMark({ image, icon, initials, glyph, size = 'md', testID }: EntityMarkProps) {
  const palette = usePalette()
  const [failedUri, setFailedUri] = useState<string | null>(null)
  const box = themeTokens.mark[size]
  const frame = { width: box, height: box, borderRadius: themeTokens.radius.md }
  const iconSize = size === 'md' ? 18 : 14
  const letters = markInitials(initials)
  const uri = isLogoUrl(image) ? image.trim() : null

  let kind: 'image' | 'icon' | 'initials' | 'glyph' | 'empty'
  if (uri && failedUri !== uri) kind = 'image'
  else if (icon) kind = 'icon'
  else if (letters) kind = 'initials'
  else if (glyph) kind = 'glyph'
  else kind = 'empty'

  if (kind === 'image' && uri) {
    const inset = size === 'md' ? 4 : 2
    return (
      <View
        accessible={false}
        importantForAccessibility="no-hide-descendants"
        style={[styles.mark, frame, { backgroundColor: themeTokens.mark.logoBacking, borderColor: palette.border, padding: inset }]}
        testID={testID}
      >
        <Image
          accessible={false}
          contentFit="contain"
          onError={() => setFailedUri(uri)}
          recyclingKey={uri}
          source={{ uri }}
          style={styles.image}
          testID={testID ? `${testID}-image` : undefined}
        />
      </View>
    )
  }

  if (kind === 'icon' && icon) {
    const tint = safeColor(icon.bgColor)
    const background = tint ?? palette.muted
    const ink = safeColor(icon.textColor) ?? (tint ? contrastingInk(tint) : palette.foreground)
    return (
      <View accessible={false} importantForAccessibility="no-hide-descendants" style={[styles.mark, frame, styles.borderless, { backgroundColor: background }]} testID={testID}>
        <CategoryIcon color={ink} icon={icon.name} size={iconSize} />
      </View>
    )
  }

  return (
    <View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={[styles.mark, frame, { backgroundColor: palette.muted, borderColor: palette.border }]}
      testID={testID}
    >
      {kind === 'initials' ? (
        <Text maxFontSizeMultiplier={1} numberOfLines={1} tone="muted" variant="amountSmall">{letters}</Text>
      ) : kind === 'glyph' && glyph ? (
        <Icon color={palette.mutedForeground} name={glyph} size={iconSize} />
      ) : null}
    </View>
  )
}

// ── Sources for the things the app lists ───────────────────────────────────

/** Web `FinancialAssetLogo`: a cash position (`CURRENCY_EUR`) is coins; a security is its logo, then its ticker's letters. */
export function assetMark(symbol: string | null | undefined, logoUrl: string | null | undefined): EntityMarkSource {
  if (symbol?.startsWith('CURRENCY_')) return { glyph: 'coins' }
  return { image: logoUrl ?? null, initials: symbol ?? null, glyph: 'line-chart' }
}

const ACCOUNT_TYPE_GLYPHS: Readonly<Record<string, IconName>> = {
  CHECKING: 'landmark',
  SAVINGS: 'piggy-bank',
  INVESTMENT: 'line-chart',
  MORTGAGE: 'home',
  CREDIT_CARD: 'credit-card',
  LOAN: 'hand-coins',
}

/**
 * An account: its institution's logo, then the institution's letters, then a
 * glyph for its type (a house for a mortgage, a card for a credit card), and
 * a bank for anything else.
 */
export function accountMark(account: Readonly<{ logoUrl?: string | null; institutionName?: string | null; type?: string | null }>): EntityMarkSource {
  const glyph = (account.type && ACCOUNT_TYPE_GLYPHS[account.type.trim().toUpperCase()]) || 'landmark'
  return { image: account.logoUrl ?? null, initials: account.institutionName ?? null, glyph }
}

/** A portfolio: its broker's logo or letters ("Degiro" → "DE") when it has one, otherwise a briefcase. */
export function portfolioMark(broker?: Readonly<{ logoUrl?: string | null; name?: string | null }> | null): EntityMarkSource {
  return { image: broker?.logoUrl ?? null, initials: broker?.name ?? null, glyph: 'briefcase' }
}

const styles = StyleSheet.create({
  mark: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth },
  borderless: { borderWidth: 0 },
  image: { width: '100%', height: '100%' },
})
