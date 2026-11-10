import { SymbolView, type SymbolWeight } from 'expo-symbols'
import type { ComponentProps } from 'react'
import { Platform, View } from 'react-native'

import { themeTokens } from '@/theme/tokens'

type SymbolName = ComponentProps<typeof SymbolView>['name']

/**
 * Web's lucide glyphs, by their lucide name, mapped to the closest SF Symbol
 * (iOS) and Material Symbol (Android). Outline glyphs, because lucide is a
 * line set; the bottom bar shows "current" with weight, not with a filled
 * glyph, exactly as web does with `strokeWidth`.
 */
const ICONS = {
  home: { ios: 'house', android: 'home', web: 'home' },
  landmark: { ios: 'building.columns', android: 'account_balance', web: 'account_balance' },
  'pie-chart': { ios: 'chart.pie', android: 'pie_chart', web: 'pie_chart' },
  briefcase: { ios: 'briefcase', android: 'work', web: 'work' },
  'layout-grid': { ios: 'square.grid.2x2', android: 'grid_view', web: 'grid_view' },
  plus: { ios: 'plus', android: 'add', web: 'add' },
  'chevron-down': { ios: 'chevron.down', android: 'keyboard_arrow_down', web: 'keyboard_arrow_down' },
  'chevron-right': { ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' },
  'chevron-left': { ios: 'chevron.left', android: 'chevron_left', web: 'chevron_left' },
  'arrow-left': { ios: 'arrow.left', android: 'arrow_back', web: 'arrow_back' },
  'arrow-right': { ios: 'arrow.right', android: 'arrow_forward', web: 'arrow_forward' },
  'arrow-down-left': { ios: 'arrow.down.left', android: 'south_west', web: 'south_west' },
  'arrow-up-right': { ios: 'arrow.up.right', android: 'north_east', web: 'north_east' },
  'trending-up': { ios: 'arrow.up.right', android: 'trending_up', web: 'trending_up' },
  'trending-down': { ios: 'arrow.down.right', android: 'trending_down', web: 'trending_down' },
  'circle-help': { ios: 'questionmark.circle', android: 'help', web: 'help' },
  'more-horizontal': { ios: 'ellipsis', android: 'more_horiz', web: 'more_horiz' },
  // The overflow menu on a title row: each platform's own glyph, the
  // horizontal ellipsis on iOS (its convention) and Material's vertical one.
  'more-vertical': { ios: 'ellipsis', android: 'more_vert', web: 'more_vert' },
  'piggy-bank': { ios: 'banknote', android: 'savings', web: 'savings' },
  settings: { ios: 'gearshape', android: 'settings', web: 'settings' },
  'log-out': { ios: 'rectangle.portrait.and.arrow.right', android: 'logout', web: 'logout' },
  moon: { ios: 'moon', android: 'dark_mode', web: 'dark_mode' },
  sun: { ios: 'sun.max', android: 'light_mode', web: 'light_mode' },
  palette: { ios: 'paintpalette', android: 'palette', web: 'palette' },
  lightbulb: { ios: 'lightbulb', android: 'lightbulb', web: 'lightbulb' },
  calendar: { ios: 'calendar', android: 'calendar_today', web: 'calendar_today' },
  // iOS has no funnel symbol (line.3.horizontal.decrease is three lines), so
  // iOS draws lucide's Filter itself: see FUNNEL below.
  filter: { ios: 'line.3.horizontal.decrease', android: 'filter_alt', web: 'filter_alt' },
  'refresh-cw': { ios: 'arrow.triangle.2.circlepath', android: 'sync', web: 'sync' },
  link: { ios: 'link', android: 'link', web: 'link' },
  pencil: { ios: 'pencil', android: 'edit', web: 'edit' },
  trash: { ios: 'trash', android: 'delete', web: 'delete' },
  search: { ios: 'magnifyingglass', android: 'search', web: 'search' },
  x: { ios: 'xmark', android: 'close', web: 'close' },
  check: { ios: 'checkmark', android: 'check', web: 'check' },
  target: { ios: 'target', android: 'target', web: 'target' },
  'receipt-text': { ios: 'receipt', android: 'receipt_long', web: 'receipt_long' },
  'bar-chart': { ios: 'chart.bar.xaxis', android: 'bar_chart', web: 'bar_chart' },
  'candlestick-chart': { ios: 'chart.bar.xaxis', android: 'candlestick_chart', web: 'candlestick_chart' },
  upload: { ios: 'square.and.arrow.up', android: 'upload', web: 'upload' },
  'external-link': { ios: 'arrow.up.right.square', android: 'open_in_new', web: 'open_in_new' },
  star: { ios: 'star', android: 'star', web: 'star' },
  'star-filled': { ios: 'star.fill', android: 'star', web: 'star' },
  lock: { ios: 'lock', android: 'lock', web: 'lock' },
  download: { ios: 'arrow.down.to.line', android: 'download', web: 'download' },
  'file-down': { ios: 'arrow.down.doc', android: 'file_download', web: 'file_download' },
  'rotate-ccw': { ios: 'arrow.counterclockwise', android: 'restart_alt', web: 'restart_alt' },
  'arrow-left-right': { ios: 'arrow.left.arrow.right', android: 'swap_horiz', web: 'swap_horiz' },
  'alert-circle': { ios: 'exclamationmark.circle', android: 'error', web: 'error' },
  'alert-triangle': { ios: 'exclamationmark.triangle', android: 'warning', web: 'warning' },
  'chevron-up': { ios: 'chevron.up', android: 'keyboard_arrow_up', web: 'keyboard_arrow_up' },
  minus: { ios: 'minus', android: 'remove', web: 'remove' },
  'check-circle': { ios: 'checkmark.circle', android: 'check_circle', web: 'check_circle' },
  // More list, settings and onboarding (web BottomNavMoreSheet, FirstRunGoalSelector, FirstRunWelcomeStep).
  'calendar-clock': { ios: 'calendar.badge.clock', android: 'event_repeat', web: 'event_repeat' },
  'hand-coins': { ios: 'dollarsign.circle', android: 'payments', web: 'payments' },
  'book-open': { ios: 'book', android: 'menu_book', web: 'menu_book' },
  'message-square': { ios: 'bubble.left', android: 'chat_bubble', web: 'chat_bubble' },
  'file-text': { ios: 'doc.text', android: 'description', web: 'description' },
  shield: { ios: 'shield', android: 'shield', web: 'shield' },
  mail: { ios: 'envelope', android: 'mail', web: 'mail' },
  layers: { ios: 'square.3.layers.3d', android: 'layers', web: 'layers' },
  'shield-check': { ios: 'checkmark.shield', android: 'verified_user', web: 'verified_user' },
  'wallet-cards': { ios: 'wallet.pass', android: 'wallet', web: 'wallet' },
  'line-chart': { ios: 'chart.xyaxis.line', android: 'show_chart', web: 'show_chart' },
  'circle-dollar-sign': { ios: 'dollarsign.circle', android: 'paid', web: 'paid' },
  compass: { ios: 'safari', android: 'explore', web: 'explore' },
  // EntityMark glyphs: cash positions, uncategorised rows, account types.
  coins: { ios: 'centsign.circle', android: 'toll', web: 'toll' },
  tag: { ios: 'tag', android: 'sell', web: 'sell' },
  'credit-card': { ios: 'creditcard', android: 'credit_card', web: 'credit_card' },
  info: { ios: 'info.circle', android: 'info', web: 'info' },
  // Manually valued assets: a vehicle and a valuable (a home is `home`).
  car: { ios: 'car', android: 'directions_car', web: 'directions_car' },
  gem: { ios: 'diamond', android: 'diamond', web: 'diamond' },
  // Privacy mode: amounts shown / hidden.
  eye: { ios: 'eye', android: 'visibility', web: 'visibility' },
  'eye-off': { ios: 'eye.slash', android: 'visibility_off', web: 'visibility_off' },
} as const satisfies Record<string, SymbolName>

export type IconName = keyof typeof ICONS

export type IconProps = {
  /** A lucide name from web's source (`TrendingUp` → `trending-up`). */
  name: IconName
  /** Defaults to 16 (lucide `size-4`). Use `themeTokens.size.icon` (20) for `size-5`. */
  size?: number
  /** A palette value. Required: an icon has no colour of its own. */
  color: string
  /** `semibold` for a current/active glyph (web `strokeWidth={2}`); iOS only. */
  weight?: SymbolWeight
}

/**
 * One icon, decorative by default (`accessible={false}`): the control around
 * it carries the label, as web's `aria-hidden` icons do.
 */
export function Icon({ name, size = themeTokens.size.iconSmall, color, weight = 'regular' }: IconProps) {
  if (name === 'filter' && Platform.OS === 'ios') return <Funnel color={color} size={size} weight={weight} />
  return (
    <SymbolView
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      name={ICONS[name] as SymbolName}
      size={size}
      tintColor={color}
      weight={weight}
    />
  )
}

/**
 * lucide `Filter` (a funnel) on its 24-unit grid: the polygon
 * 22,3 2,3 10,12.46 10,19 14,21 14,12.46, one segment per edge.
 */
const FUNNEL: readonly (readonly [number, number, number, number])[] = [
  [2, 3, 22, 3],
  [2, 3, 10, 12.46],
  [22, 3, 14, 12.46],
  [10, 12.46, 10, 19],
  [14, 12.46, 14, 21],
  [10, 19, 14, 21],
]

/** Strokes drawn as rounded bars, at lucide's stroke 2 (heavier for semibold and up). */
function Funnel({ size, color, weight }: { size: number; color: string; weight: SymbolWeight }) {
  const scale = size / 24
  const heavy = weight === 'semibold' || weight === 'bold' || weight === 'heavy' || weight === 'black'
  const stroke = (heavy ? 2.25 : 1.75) * scale
  return (
    <View accessible={false} importantForAccessibility="no-hide-descendants" style={{ width: size, height: size }}>
      {FUNNEL.map(([x1, y1, x2, y2]) => {
        const dx = (x2 - x1) * scale
        const dy = (y2 - y1) * scale
        const length = Math.hypot(dx, dy) + stroke
        return (
          <View
            key={`${x1},${y1},${x2},${y2}`}
            style={{
              position: 'absolute',
              left: ((x1 + x2) / 2) * scale - length / 2,
              top: ((y1 + y2) / 2) * scale - stroke / 2,
              width: length,
              height: stroke,
              borderRadius: stroke / 2,
              backgroundColor: color,
              transform: [{ rotate: `${Math.atan2(dy, dx)}rad` }],
            }}
          />
        )
      })}
    </View>
  )
}
