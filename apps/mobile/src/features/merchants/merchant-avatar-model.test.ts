import { contrastRatio, oklchToSrgb } from '@/theme/color-math'
import { merchantAvatarColors, merchantAvatarSources } from '@/theme/tokens'

import { merchantAvatarColorsFor, merchantColorIndex, merchantInitial, normalizeMerchantName } from './merchant-avatar-model'

const HALVES = ['light', 'dark'] as const
/** Normal text (the initial is 14pt). */
const TEXT_FLOOR = 4.5
/** The order web and mobile share, so a merchant has one hue everywhere. */
const HUE_ORDER = ['blue', 'teal', 'amber', 'fuchsia', 'sky', 'orange', 'stone', 'slate']
/**
 * Hue bands no slot may use (OKLCH degrees): red and green carry money lost and gained, and
 * violet is the brand accent's alone (web `DESIGN.md`). The same bands as web's test.
 */
const RESERVED_BANDS = [
  { name: 'red', from: 0, to: 40 },
  { name: 'red', from: 345, to: 360 },
  { name: 'green', from: 130, to: 170 },
  { name: 'violet', from: 270, to: 310 },
] as const

const convert = (source: string) => {
  const [l, c, h] = source.split(' ').map(Number) as [number, number, number]
  return oklchToSrgb(l, c, h).hex
}

describe('merchant avatar model', () => {
  it("normalizes a name the way the API's normalizeMerchantName does", () => {
    expect(normalizeMerchantName('  Café   NERO ')).toBe('cafe nero')
    expect(normalizeMerchantName('Pão de Açúcar')).toBe('pao de acucar')
  })

  it('gives every spelling of one merchant the same colour', () => {
    expect(merchantColorIndex('Café Nero')).toBe(merchantColorIndex('  cafe   NERO '))
    expect(merchantAvatarColorsFor('Café Nero', 'light')).toEqual(merchantAvatarColorsFor('  cafe   NERO ', 'light'))
    expect(merchantAvatarColorsFor('Café Nero', 'dark')).toEqual(merchantAvatarColorsFor('  cafe   NERO ', 'dark'))
  })

  it('hashes with 32-bit FNV-1a over the normalized name (pinned, so web and mobile agree)', () => {
    // fnv1a('starbucks') = 3426220875, and 3426220875 % 8 = 3 (fuchsia).
    expect(merchantColorIndex('starbucks')).toBe(3)
    expect(merchantColorIndex('Starbucks')).toBe(3)
    expect(merchantColorIndex('Café Nero')).toBe(6)
    expect(merchantColorIndex('starbucks', 7)).toBe(3426220875 % 7)
  })

  it("shows the name's first letter or digit, upper-cased, and ? when there is none", () => {
    expect(merchantInitial('starbucks')).toBe('S')
    expect(merchantInitial('  "éclair" bakery')).toBe('É')
    expect(merchantInitial('7-Eleven')).toBe('7')
    expect(merchantInitial(' · — ')).toBe('?')
  })
})

describe('merchant avatar palette', () => {
  it('has eight slots in the shared hue order, in both halves', () => {
    for (const half of HALVES) {
      expect(merchantAvatarSources[half].map((slot) => slot.hue)).toEqual(HUE_ORDER)
      expect(merchantAvatarColors[half]).toHaveLength(HUE_ORDER.length)
    }
  })

  it.each(HALVES)('commits the sRGB conversion of every OKLCH source (%s)', (half) => {
    const drift: string[] = []
    merchantAvatarSources[half].forEach((source, index) => {
      const committed = merchantAvatarColors[half][index]!
      for (const role of ['background', 'foreground'] as const) {
        const hex = convert(source[role])
        if (committed[role] !== hex) drift.push(`${source.hue} ${role}: committed ${committed[role]}, oklch(${source[role]}) converts to ${hex}`)
      }
    })
    expect(drift).toEqual([])
  })

  it.each(HALVES)('every initial clears 4.5:1 on its colour (%s)', (half) => {
    const failures: string[] = []
    merchantAvatarColors[half].forEach(({ background, foreground }, index) => {
      const ratio = contrastRatio(foreground, background)
      if (ratio < TEXT_FLOOR) failures.push(`${HUE_ORDER[index]}: ${ratio.toFixed(2)}:1`)
    })
    expect(failures).toEqual([])
  })

  it('keeps every slot out of the red, green and violet bands, in both halves', () => {
    const offenders: string[] = []
    for (const half of HALVES) {
      for (const slot of merchantAvatarSources[half]) {
        for (const role of ['background', 'foreground'] as const) {
          const hue = Number(slot[role].split(' ')[2])
          const band = RESERVED_BANDS.find(({ from, to }) => hue >= from && hue <= to)
          if (band) offenders.push(`${half} ${slot.hue} ${role}: hue ${hue} is ${band.name}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('keeps each slot on one hue across the themes', () => {
    merchantAvatarSources.light.forEach((light, index) => {
      const dark = merchantAvatarSources.dark[index]!
      for (const role of ['background', 'foreground'] as const) {
        expect(dark[role].split(' ')[2]).toBe(light[role].split(' ')[2])
      }
    })
  })
})
