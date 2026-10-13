/**
 * OKLCH → sRGB, plus WCAG contrast, for the design-system sync guard.
 *
 * This is test-and-tooling code, not runtime code: the app reads committed hex
 * from `tokens.ts`. It lives in `src/` rather than `scripts/` only so the guard
 * can import it without a second tsconfig.
 *
 * Conversion follows Björn Ottosson's Oklab matrices as specified in CSS Color
 * Level 4. Values outside the sRGB gamut are clipped per channel, and
 * `clipped` reports it — a clipped colour is not a bug here (six of the light
 * half's tokens are out of gamut by construction) but it does mean the
 * rendered contrast has to be measured on the clipped value, which is what
 * `contrastRatio` below is for.
 */

export type Rgb = { r: number; g: number; b: number }

export function oklchToSrgb(l: number, c: number, hDegrees: number): { hex: string; clipped: boolean } {
  const h = (hDegrees * Math.PI) / 180
  const a = c * Math.cos(h)
  const b = c * Math.sin(h)

  const lRoot = l + 0.3963377774 * a + 0.2158037573 * b
  const mRoot = l - 0.1055613458 * a - 0.0638541728 * b
  const sRoot = l - 0.0894841775 * a - 1.291485548 * b

  const lLinear = lRoot ** 3
  const mLinear = mRoot ** 3
  const sLinear = sRoot ** 3

  const red = 4.0767416621 * lLinear - 3.3077115913 * mLinear + 0.2309699292 * sLinear
  const green = -1.2684380046 * lLinear + 2.6097574011 * mLinear - 0.3413193965 * sLinear
  const blue = -0.0041960863 * lLinear - 0.7034186147 * mLinear + 1.707614701 * sLinear

  const tolerance = 1e-4
  const clipped = [red, green, blue].some((channel) => channel < -tolerance || channel > 1 + tolerance)

  const hex = `#${[red, green, blue].map(encodeChannel).join('')}`
  return { hex, clipped }
}

function encodeChannel(linear: number): string {
  const gamma = linear <= 0.0031308 ? 12.92 * linear : 1.055 * linear ** (1 / 2.4) - 0.055
  const byte = Math.min(255, Math.max(0, Math.round(gamma * 255)))
  return byte.toString(16).padStart(2, '0')
}

export function hexToRgb(hex: string): Rgb {
  const value = hex.replace('#', '')
  return {
    r: parseInt(value.slice(0, 2), 16) / 255,
    g: parseInt(value.slice(2, 4), 16) / 255,
    b: parseInt(value.slice(4, 6), 16) / 255,
  }
}

export function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex)
  const linearise = (channel: number) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
  return 0.2126 * linearise(r) + 0.7152 * linearise(g) + 0.0722 * linearise(b)
}

/** WCAG 2.x contrast ratio between two opaque colours. */
export function contrastRatio(a: string, b: string): number {
  const [lighter, darker] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x)
  return (lighter + 0.05) / (darker + 0.05)
}
