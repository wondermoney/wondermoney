import { useColorScheme } from 'react-native'

import { themeTokens, type Palette } from '@/theme/tokens'

/**
 * The half of the system this render belongs to.
 *
 * Every screen was repeating `themeTokens.colors[useColorScheme() === 'dark' ?
 * 'dark' : 'light']` inline. The repetition is not the problem — the problem is
 * that each copy is a place where the null case (`useColorScheme()` returns
 * `null` before the first native value arrives) can be handled differently, and
 * a screen that resolves `null` to `dark` while its neighbour resolves it to
 * `light` flickers between halves on cold start.
 *
 * Light is the resolution for `null` here, once, for everyone.
 */
export function usePalette(): Palette {
  return themeTokens.colors[useColorScheme() === 'dark' ? 'dark' : 'light']
}

export type { Palette }
