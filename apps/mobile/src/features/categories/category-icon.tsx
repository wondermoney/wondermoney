import { SymbolView } from 'expo-symbols'
import type { AndroidSymbol } from 'expo-symbols'
import type { StyleProp, ViewStyle } from 'react-native'
import type { SFSymbol } from 'sf-symbols-typescript'

// Each category icon name (from CATEGORY_ICONS in categories-contract.ts) maps to a
// distinct SF Symbol (iOS) and Material Symbol (Android/web) name. Categories can
// carry an icon name the client doesn't recognize (the read schema allows any
// string), so callers always fall back to `folder` rather than collapsing several
// icons onto one shared glyph.
const CATEGORY_ICON_SYMBOLS: Readonly<Record<string, { ios: SFSymbol; android: AndroidSymbol }>> = {
  house: { ios: 'house.fill', android: 'home' },
  home: { ios: 'house.fill', android: 'home' },
  banknote: { ios: 'banknote.fill', android: 'payments' },
  zap: { ios: 'bolt.fill', android: 'bolt' },
  'cooking-pot': { ios: 'fork.knife', android: 'skillet' },
  navigation: { ios: 'location.north.fill', android: 'navigation' },
  'tree-palm': { ios: 'beach.umbrella.fill', android: 'beach_access' },
  users: { ios: 'person.2.fill', android: 'group' },
  'heart-pulse': { ios: 'waveform.path.ecg', android: 'monitor_heart' },
  shield: { ios: 'shield.fill', android: 'shield' },
  'shield-question': { ios: 'exclamationmark.shield.fill', android: 'gpp_maybe' },
  question: { ios: 'questionmark.circle.fill', android: 'help' },
  car: { ios: 'car.fill', android: 'directions_car' },
  bus: { ios: 'bus.fill', android: 'directions_bus' },
  fuel: { ios: 'fuelpump.fill', android: 'local_gas_station' },
  coffee: { ios: 'cup.and.saucer.fill', android: 'local_cafe' },
  folder: { ios: 'folder.fill', android: 'folder' },
  briefcase: { ios: 'briefcase.fill', android: 'work' },
  building: { ios: 'building.2.fill', android: 'apartment' },
  'credit-card': { ios: 'creditcard.fill', android: 'credit_card' },
  plane: { ios: 'airplane', android: 'flight' },
  gift: { ios: 'gift.fill', android: 'redeem' },
  music: { ios: 'music.note', android: 'music_note' },
  wrench: { ios: 'wrench.fill', android: 'build' },
  water: { ios: 'drop.fill', android: 'water_drop' },
}

const FALLBACK_SYMBOL = CATEGORY_ICON_SYMBOLS.folder!

export function resolveCategorySymbol(icon: string | null | undefined): { ios: SFSymbol; android: AndroidSymbol } {
  if (!icon) return FALLBACK_SYMBOL
  const normalized = icon.trim().replace(/_/g, '-').replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()
  return CATEGORY_ICON_SYMBOLS[normalized] ?? FALLBACK_SYMBOL
}

export function CategoryIcon({ icon, color, size = 18, style }: {
  icon: string | null | undefined
  color: string
  size?: number
  style?: StyleProp<ViewStyle>
}) {
  const symbol = resolveCategorySymbol(icon)
  return <SymbolView name={{ ios: symbol.ios, android: symbol.android, web: symbol.android }} size={size} tintColor={color} style={style} />
}
