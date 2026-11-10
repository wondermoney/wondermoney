import { useTranslation } from 'react-i18next'
import { useState } from 'react'
import { Pressable, StyleSheet } from 'react-native'
import { useRouter, type Href } from 'expo-router'

import { Icon } from '@/components/ui/icon'
import { Text } from '@/components/ui/text'
import { themeTokens } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'

export type BackLinkProps = {
  /** The visible destination name ("Accounts"). Web's `backLabel`. */
  label: string
  /** Called on press. */
  onPress: () => void
  /** What screen readers announce; defaults to `label`. */
  accessibilityLabel?: string
  disabled?: boolean
  testID?: string
}

/**
 * Web's back link on a detail page (`ObjectHeader`'s ghost `sm` button):
 * an arrow-left and the parent's name, muted 14px, sitting just above the
 * page title. Pressing it is navigation, not decoration, so it has a 44pt
 * target (drawn 36, plus `hitSlop`) and a visible focus ring.
 */
export function BackLink({ label, onPress, accessibilityLabel, disabled = false, testID }: BackLinkProps) {
  const palette = usePalette()
  const [focused, setFocused] = useState(false)
  const slop = (themeTokens.touchTarget.minimum - themeTokens.size.controlSmall) / 2
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityRole="button"
      accessibilityState={{ disabled, busy: false }}
      disabled={disabled}
      hitSlop={{ top: slop, bottom: slop }}
      onBlur={() => setFocused(false)}
      onFocus={() => setFocused(true)}
      onPress={onPress}
      style={({ pressed }) => [
        styles.control,
        focused && { borderWidth: 2, borderColor: palette.ring },
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}
      testID={testID}
    >
      <Icon color={palette.mutedForeground} name="arrow-left" />
      <Text importantForAccessibility="no" tone="muted" variant="metaStrong">
        {label}
      </Text>
    </Pressable>
  )
}

export type BackControlProps = {
  fallback: Href
  onPress?: () => void
  /**
   * @deprecated The back control has one look on every screen (web's muted
   * back link). Accepted so older call sites keep compiling; **ignored**.
   */
  color?: string
  disabled?: boolean
  /** What screen readers announce ("Back to More"). Defaults to "Back". */
  label?: string
  /**
   * The visible destination name. Defaults to the section `fallback` belongs
   * to ("/accounts" → "Accounts", "/more" → "More"), or "Back" when it
   * belongs to none.
   */
  destination?: string
}

/**
 * The back affordance for pushed product routes, drawn as web's `BackLink`
 * ("← Accounts"). Goes back when there is history, else replaces with
 * `fallback`, so a deep-linked detail page still has somewhere to go.
 */
export function BackControl({ fallback, onPress, disabled = false, label, destination }: BackControlProps) {
  const router = useRouter()
  const { t } = useTranslation()
  const back = () => {
    if (disabled) return
    if (onPress) return onPress()
    if (router.canGoBack()) router.back()
    else router.replace(fallback)
  }
  const key = destinationKeyFor(fallback)
  const visibleLabel = destination ?? (key ? t(key) : t('common.back'))
  return (
    <BackLink
      accessibilityLabel={label ?? t('common.back')}
      disabled={disabled}
      label={visibleLabel}
      onPress={back}
    />
  )
}

/** Longest-prefix-first: a fallback names the page it returns to. */
const DESTINATIONS: [prefix: string, key: string][] = [
  ['/accounts/transactions', 'navigation.transactions'],
  ['/accounts/recurring', 'navigation.billsSubscriptions'],
  ['/accounts', 'navigation.accounts'],
  ['/portfolio/activity', 'navigation.transactions'],
  ['/portfolio', 'navigation.portfolio'],
  ['/budgets', 'navigation.budgets'],
  ['/goals', 'navigation.goals'],
  ['/loans', 'navigation.loans'],
  ['/reports', 'navigation.reports'],
  ['/markets/watchlist', 'navigation.watchlist'],
  ['/markets', 'navigation.financialMarkets'],
  ['/more/banking', 'more.bankConnections'],
  ['/settings/categories', 'more.categories'],
  ['/settings/profile', 'more.profile'],
  ['/more', 'navigation.more'],
]

export function destinationKeyFor(fallback: Href): string | null {
  const path = typeof fallback === 'string' ? fallback : (fallback as { pathname?: string }).pathname
  if (!path) return null
  if (path === '/') return 'navigation.home'
  const match = DESTINATIONS.find(([prefix]) => path === prefix || path.startsWith(`${prefix}/`))
  return match ? match[1] : null
}

const styles = StyleSheet.create({
  control: {
    alignSelf: 'flex-start',
    minHeight: themeTokens.size.controlSmall,
    flexDirection: 'row',
    alignItems: 'center',
    gap: themeTokens.spacing[2],
    // Web's `-ml-2` on a `px-3` ghost button: the arrow sits near the margin.
    paddingRight: themeTokens.spacing[2],
    borderRadius: themeTokens.radius.md,
  },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.5 },
})
