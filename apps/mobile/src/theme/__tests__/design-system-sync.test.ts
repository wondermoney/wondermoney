/**
 * The guard between `tokens.ts` and the locked system in `DESIGN.md`.
 *
 * A contrast failure looks exactly like a colour choice in review — the web
 * half shipped a red `--destructive-foreground` on a red `--destructive` fill
 * for months, unreadable in dark mode, and nobody caught it by looking. So it
 * is measured here instead of trusted.
 *
 * Three things are checked:
 *
 *  1. Every committed hex is still the sRGB conversion of its recorded OKLCH,
 *     so a hand-edited colour can't quietly diverge from web.
 *  2. Every fill clears 4.5:1 against its own `-foreground`, at rest and at
 *     the 90% press state — fading a fill toward the canvas *raises* its
 *     lightness, so a press state can fail where the rest state passed.
 *  3. Every semantic `-text` token clears 4.5:1 on the canvas, and the two
 *     boundary tokens clear the 3:1 non-text floor.
 *
 * All of it runs on both halves. Every colour decision is made twice or it is
 * not made.
 */

import { colorSources, themeTokens } from '@/theme/tokens'
import { contrastRatio, oklchToSrgb } from '@/theme/color-math'

const HALVES = ['light', 'dark'] as const

/** Normal text. */
const TEXT_FLOOR = 4.5
/** Meaningful UI boundaries and focus indicators (WCAG 1.4.11 / 2.4.11). */
const BOUNDARY_FLOOR = 3

describe('design system sync', () => {
  describe.each(HALVES)('%s half', (half) => {
    const palette = themeTokens.colors[half]
    const sources = colorSources[half]

    it('every committed hex is the conversion of its recorded OKLCH', () => {
      const drift: string[] = []
      for (const [token, source] of Object.entries(sources)) {
        const [l, c, h] = source.split(' ').map(Number)
        const { hex } = oklchToSrgb(l, c, h)
        const committed = palette[token as keyof typeof sources]
        if (committed !== hex) {
          drift.push(`${token}: committed ${committed}, oklch(${source}) converts to ${hex}`)
        }
      }
      expect(drift).toEqual([])
    })

    it('every fill clears 4.5:1 against its own foreground, at rest and pressed', () => {
      const pairs = [
        ['primary', 'primaryForeground'],
        ['secondary', 'secondaryForeground'],
        ['accent', 'accentForeground'],
        ['destructive', 'destructiveForeground'],
        ['warning', 'warningForeground'],
        ['info', 'infoForeground'],
        ['success', 'successForeground'],
      ] as const

      const failures: string[] = []
      for (const [fill, ink] of pairs) {
        // The press state composites the fill at 90% over the canvas rather
        // than fading the ink, so it is a real colour that has to be measured.
        const pressed = blend(palette[fill], palette.background, 0.9)
        const rest = contrastRatio(palette[fill], palette[ink])
        const press = contrastRatio(pressed, palette[ink])
        if (rest < TEXT_FLOOR) failures.push(`${fill}/${ink} at rest: ${rest.toFixed(2)}:1`)
        if (press < TEXT_FLOOR) failures.push(`${fill}/${ink} pressed: ${press.toFixed(2)}:1`)
      }
      expect(failures).toEqual([])
    })

    it('every semantic text token clears 4.5:1 on the canvas and on a card', () => {
      const failures: string[] = []
      for (const token of ['foreground', 'mutedForeground', 'destructiveText', 'warningText', 'infoText', 'successText'] as const) {
        for (const surface of ['background', 'card'] as const) {
          const ratio = contrastRatio(palette[token], palette[surface])
          if (ratio < TEXT_FLOOR) failures.push(`${token} on ${surface}: ${ratio.toFixed(2)}:1`)
        }
      }
      expect(failures).toEqual([])
    })

    it('the focus ring and the control boundary clear the 3:1 non-text floor', () => {
      expect(contrastRatio(palette.ring, palette.background)).toBeGreaterThanOrEqual(BOUNDARY_FLOOR)
      expect(contrastRatio(palette.input, palette.background)).toBeGreaterThanOrEqual(BOUNDARY_FLOOR)
      expect(contrastRatio(palette.input, palette.card)).toBeGreaterThanOrEqual(BOUNDARY_FLOOR)
    })

    it('the chart ramp is separable against the canvas', () => {
      // Assigned in order and never cycled, so what matters is that each slot
      // is visible on its own canvas — the adjacent-pair CVD work is done on
      // the web half, where the values come from, and is not re-derived here.
      for (const slot of ['chart1', 'chart2', 'chart3', 'chart4', 'chart5'] as const) {
        expect(contrastRatio(palette[slot], palette.background)).toBeGreaterThanOrEqual(BOUNDARY_FLOOR)
      }
    })
  })

  it('hue is fixed per chart slot across both halves', () => {
    // The web half shipped two unrelated ramps once, so `chart-1` was orange in
    // light and blue in dark and any chart with a legend meant something
    // different depending on the theme. Only lightness and chroma may move.
    for (const slot of ['chart1', 'chart2', 'chart3', 'chart4', 'chart5'] as const) {
      const lightHue = Number(colorSources.light[slot].split(' ')[2])
      const darkHue = Number(colorSources.dark[slot].split(' ')[2])
      expect(darkHue).toBeCloseTo(lightHue, 5)
    }
  })

  it('every violet in the system is hue 290', () => {
    for (const half of HALVES) {
      for (const token of ['primary', 'ring', 'chart1'] as const) {
        expect(Number(colorSources[half][token].split(' ')[2])).toBe(290)
      }
    }
  })

  it('the scrim does not invert with the theme', () => {
    // A scrim darkens whatever sits behind it. Following the theme would paint
    // a near-white wash over dark UI.
    expect(themeTokens.colors.light.scrim).toBe(themeTokens.colors.dark.scrim)
    expect(colorSources.light.overlay).toBe(colorSources.dark.overlay)
  })

  it('card and popover share the canvas value — hierarchy comes from the border', () => {
    for (const half of HALVES) {
      const palette = themeTokens.colors[half]
      expect(palette.card).toBe(palette.background)
      expect(palette.popover).toBe(palette.background)
      expect(palette.border).not.toBe(palette.background)
    }
  })
})

/** Composite `color` at `alpha` over `over`, returning an opaque hex. */
function blend(color: string, over: string, alpha: number): string {
  const parse = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
  const [r1, g1, b1] = parse(color)
  const [r2, g2, b2] = parse(over)
  const mix = (a: number, b: number) => Math.round(a * alpha + b * (1 - alpha))
  return `#${[mix(r1, r2), mix(g1, g2), mix(b1, b2)].map((v) => v.toString(16).padStart(2, '0')).join('')}`
}
