/**
 * WonderMoney mobile design tokens — the React Native half of the system
 * locked in `DESIGN.md` (this repo) and `../web/DESIGN.md`.
 *
 * ## Why these are hex and not oklch
 *
 * The web system is authored in OKLCH. React Native's colour parser
 * (`@react-native/normalize-colors`) understands hex, `rgb()`, `rgba()`,
 * `hsl()`, `hsla()`, `hwb()` and named colours — and nothing else. `oklch()`
 * is not in it, on any current version. So every value below is the *same*
 * colour, converted once to sRGB and committed.
 *
 * The OKLCH source of every token is recorded in `colorSources` at the bottom
 * of this file, and `theme/__tests__/design-system-sync.test.ts` recomputes the
 * conversion and fails if a hex here stops matching its OKLCH. That guard is
 * the only thing standing between this file and silent drift from web, so do
 * not edit a hex by hand: change the OKLCH source and let the guard tell you
 * the new hex.
 *
 * Six light-half and two dark-half tokens land outside the sRGB gamut and are
 * clipped by the conversion. That is recorded rather than hidden — the guard
 * measures contrast on the *clipped* values, so the floors below are what the
 * device actually renders, not what the ideal colour would have measured.
 * Every text pair clears 4.5:1 and every boundary clears 3:1 in both halves.
 */

const interfaceFontFamily = 'Geist'
const dataFontFamily = 'GeistMono'

/**
 * Alpha suffixes for the two sanctioned tints. RN accepts 8-digit hex, so a
 * tint composites over whatever is behind it rather than being baked against
 * one assumed canvas — which is how the web half got `/10` wrong once (see
 * `web/DESIGN.md`'s Navigation section under Components).
 */
const ALPHA_10 = '1a'
const ALPHA_05 = '0d'
const ALPHA_50 = '80'

const lightColors = {
  background: '#faf9fe',
  foreground: '#0a0a0a',
  card: '#faf9fe',
  cardForeground: '#0a0a0a',
  popover: '#faf9fe',
  popoverForeground: '#0a0a0a',
  primary: '#6044b5',
  primaryForeground: '#f7fbfd',
  secondary: '#f5f4fa',
  secondaryForeground: '#171717',
  muted: '#f5f4fa',
  mutedForeground: '#6b6b72',
  accent: '#f5f4fa',
  accentForeground: '#171717',
  destructive: '#d90000',
  destructiveForeground: '#fef2f2',
  warning: '#d48e00',
  warningForeground: '#352206',
  info: '#0062c0',
  infoForeground: '#f3faff',
  success: '#4ac06c',
  successForeground: '#122d19',
  destructiveText: '#c51e1f',
  warningText: '#8f5d00',
  infoText: '#006da3',
  successText: '#007932',
  overlay: '#0a090f',
  border: '#e5e4ea',
  input: '#8c8b93',
  ring: '#724ed8',
  chart1: '#6b50c2',
  chart2: '#bb7400',
  chart3: '#007a58',
  chart4: '#d33d2c',
  chart5: '#0078af',
} as const

const darkColors = {
  background: '#0a090f',
  foreground: '#fafafa',
  card: '#0a090f',
  cardForeground: '#fafafa',
  popover: '#0a090f',
  popoverForeground: '#fafafa',
  primary: '#9c85fc',
  primaryForeground: '#171717',
  secondary: '#26252c',
  secondaryForeground: '#fafafa',
  muted: '#26252c',
  mutedForeground: '#a0a0a8',
  accent: '#26252c',
  accentForeground: '#fafafa',
  destructive: '#82181a',
  destructiveForeground: '#fef2f2',
  warning: '#f0ba59',
  warningForeground: '#352206',
  info: '#0096f4',
  infoForeground: '#080c0f',
  success: '#75d78d',
  successForeground: '#122d19',
  destructiveText: '#f75e53',
  warningText: '#f9ad26',
  infoText: '#02a9f7',
  successText: '#06c95e',
  overlay: '#0a090f',
  border: '#26252c',
  input: '#5d5d64',
  ring: '#9c85fc',
  chart1: '#8d77e5',
  chart2: '#c48225',
  chart3: '#009f7a',
  chart4: '#c52d1f',
  chart5: '#0085bc',
} as const

/**
 * Derived values.
 *
 * `primarySoft` / `primaryWash` are the only two tints the system sanctions
 * (`web/DESIGN.md`'s Loud/Quiet Register Rule, under Components): `--primary` is the one hue
 * that carries a tint and still clears contrast. Semantic banners take a
 * hairline border and `-text` ink on the plain surface instead — a tinted
 * semantic surface measured under the floor on web and would here too.
 *
 * `scrim` is deliberately identical in both halves. A scrim darkens what sits
 * behind it, so it must not follow the theme.
 */
function paletteFor<T extends typeof lightColors | typeof darkColors>(base: T) {
  return {
    ...base,
    primarySoft: `${base.primary}${ALPHA_10}`,
    primaryWash: `${base.primary}${ALPHA_05}`,
    scrim: `${lightColors.overlay}${ALPHA_50}`,
  } as const
}

export const themeTokens = {
  colors: {
    light: paletteFor(lightColors),
    dark: paletteFor(darkColors),
  },
  spacing: {
    0: 0,
    1: 4,
    2: 8,
    3: 12,
    4: 16,
    5: 20,
    6: 24,
    8: 32,
    10: 40,
    12: 48,
  },
  /**
   * The density contract, as named values rather than as 39 hand-picked
   * `spacing[6]`s.
   *
   * Measured on a booted simulator at 402pt: the app was spending 24pt on page
   * padding and another 24pt between every block, so a screen showing three
   * numbers used 280pt to do it and the first row of real content began a fifth
   * of the way down. The reference is *dense vertically, airy horizontally* —
   * these values move the vertical rhythm toward it and leave the horizontal
   * gutters alone.
   *
   * Change these here, not at a call site. A screen that hardcodes its own
   * padding is how the app got 23 font sizes.
   */
  layout: {
    /** Left/right and top/bottom padding of a screen's scroll content. */
    screenPadding: 16,
    /** Between top-level blocks on a screen — header, stats, list, section. */
    blockGap: 16,
    /** Between a section head and its content, and between rows in a group. */
    sectionGap: 12,
    /** A list row. The reference sits at ~52; the app was at 64–104. */
    rowMinHeight: 52,
    /** Inside a data card. Standalone units may still take `spacing[5]`. */
    cardPadding: 12,
  },
  /**
   * Base 8px, matching `--radius: 0.5rem`. Badges take `sm`, controls take
   * `md`, cards and lists take `lg`. A smaller corner reads as an instrument
   * rather than a card — that is the point of the density pass, not a taste.
   */
  radius: {
    sm: 4,
    md: 6,
    lg: 8,
    xl: 12,
    pill: 9999,
  },
  typography: {
    /**
     * One scale. The port collapsed 23 distinct literal `fontSize` values onto
     * these nine roles; a screen that needs a size not listed here is telling
     * you the role is missing, not that the scale is too small.
     *
     * Sizes are the web contract's, re-measured for a 375px column: the web
     * half's 14px table cell assumes a wide table, while on a phone the row
     * restructures into a stacked block (§ 9 rule 11) and the primary line has
     * to stay scannable. `body` is therefore 15, not 14. `title` is the web
     * value unchanged — 20/600, one treatment, no exceptions.
     */
    scale: {
      /** The one headline figure on a screen. Mono. */
      display: { fontFamily: dataFontFamily, fontSize: 28, lineHeight: 34, letterSpacing: -0.4, fontWeight: '600' },
      /** Page title. One per screen. */
      title: { fontFamily: interfaceFontFamily, fontSize: 20, lineHeight: 26, letterSpacing: -0.5, fontWeight: '600' },
      /** Section head. */
      section: { fontFamily: interfaceFontFamily, fontSize: 16, lineHeight: 22, letterSpacing: -0.2, fontWeight: '600' },
      /** Primary row line, paragraphs. */
      body: { fontFamily: interfaceFontFamily, fontSize: 15, lineHeight: 21, letterSpacing: -0.1, fontWeight: '400' },
      bodyStrong: { fontFamily: interfaceFontFamily, fontSize: 15, lineHeight: 21, letterSpacing: -0.1, fontWeight: '500' },
      /** Muted secondary lines beneath a row's primary line. */
      meta: { fontFamily: interfaceFontFamily, fontSize: 13, lineHeight: 18, letterSpacing: 0, fontWeight: '400' },
      /** Micro-label. Muted, sentence case — never uppercase, never letterspaced. */
      label: { fontFamily: interfaceFontFamily, fontSize: 12, lineHeight: 16, letterSpacing: 0, fontWeight: '400' },
      /** Control labels. */
      action: { fontFamily: interfaceFontFamily, fontSize: 15, lineHeight: 20, letterSpacing: -0.1, fontWeight: '600' },
      /** Figures inside a row. Mono. */
      amount: { fontFamily: dataFontFamily, fontSize: 15, lineHeight: 21, letterSpacing: 0, fontWeight: '400' },
      /** A figure on a secondary line. Mono. */
      amountSmall: { fontFamily: dataFontFamily, fontSize: 13, lineHeight: 18, letterSpacing: 0, fontWeight: '400' },
    },
    /**
     * Older role names, retuned onto the scale above so code reading `roles.*`
     * picks up the scale too; new code uses `scale` directly.
     *
     * @deprecated use `typography.scale`
     */
    roles: {
      interface: { fontFamily: interfaceFontFamily, fontSize: 15, lineHeight: 21, letterSpacing: -0.1 },
      data: { fontFamily: dataFontFamily, fontSize: 15, lineHeight: 21, letterSpacing: 0 },
      caption: { fontFamily: interfaceFontFamily, fontSize: 12, lineHeight: 16, letterSpacing: 0 },
      pageTitle: { fontFamily: interfaceFontFamily, fontSize: 20, lineHeight: 26, letterSpacing: -0.5 },
      sectionTitle: { fontFamily: interfaceFontFamily, fontSize: 16, lineHeight: 22, letterSpacing: -0.2 },
      action: { fontFamily: interfaceFontFamily, fontSize: 15, lineHeight: 20, letterSpacing: -0.1 },
    },
  },
  /**
   * `minimum` is this app's working value and is deliberately 4px above the
   * system's 44px floor: a pointer lands where it is aimed and a thumb does
   * not, so the extra margin is bought on the platform that needs it.
   *
   * `wcagFloor` is the WCAG 2.2 AA / web-half value, recorded as the line a
   * control may not go under — not as something to design toward. Do not
   * "simplify" a call site from `minimum` down to `wcagFloor`; three suites
   * assert 48dp and they are asserting the right thing.
   */
  touchTarget: {
    minimum: 48,
    comfortable: 48,
    wcagFloor: 44,
  },
  motion: {
    /** Press, hover, focus — feedback, not animation. */
    micro: 120,
    /** Panel and accordion state. */
    short: 200,
    /** Overlay entry; the longest anything may take. */
    long: 320,
    /**
     * No bounce and no overshoot: an interface handling money should not feel
     * springy. Bezier control points, for `Easing.bezier(...)`.
     */
    easeOut: [0.16, 1, 0.3, 1],
    easeIn: [0.7, 0, 0.84, 0],
    easeInOut: [0.65, 0, 0.35, 1],
  },
  /**
   * Depth is border-first (§ 7). This shadow is for genuinely elevated
   * surfaces only — modals, sheets, popovers. An ordinary card does not take
   * it; it takes a 1px border.
   */
  shadow: {
    overlay: {
      shadowColor: '#000000',
      shadowOpacity: 0.18,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 8 },
      elevation: 8,
    },
  },
} as const

/**
 * The OKLCH source of every colour above, as `L C H`, per half. This is what
 * `design-system-sync.test.ts` converts and compares, and what you edit when a
 * value needs to change. Mirrors `web/theme/globals.css` exactly (the source of
 * truth).
 */
export const colorSources = {
  light: {
    background: '0.985 0.006 290',
    foreground: '0.145 0 0',
    card: '0.985 0.006 290',
    cardForeground: '0.145 0 0',
    popover: '0.985 0.006 290',
    popoverForeground: '0.145 0 0',
    primary: '0.48 0.17 290',
    primaryForeground: '0.986 0.005 235.46',
    secondary: '0.97 0.007 290',
    secondaryForeground: '0.205 0 0',
    muted: '0.97 0.007 290',
    mutedForeground: '0.53 0.012 290',
    accent: '0.97 0.007 290',
    accentForeground: '0.205 0 0',
    destructive: '0.54 0.245 27.325',
    destructiveForeground: '0.971 0.013 17.38',
    warning: '0.7 0.15 75',
    warningForeground: '0.27 0.05 75',
    info: '0.48 0.2 240',
    infoForeground: '0.98 0.01 240',
    success: '0.72 0.16 150',
    successForeground: '0.27 0.05 150',
    destructiveText: '0.53 0.2 27.325',
    warningText: '0.52 0.115 75',
    infoText: '0.51 0.12 240',
    successText: '0.5 0.145 150',
    overlay: '0.145 0.012 290',
    border: '0.922 0.008 290',
    input: '0.64 0.012 290',
    ring: '0.54 0.2 290',
    chart1: '0.52 0.17 290',
    chart2: '0.62 0.14 70',
    chart3: '0.5 0.13 170',
    chart4: '0.58 0.19 30',
    chart5: '0.54 0.13 235',
  },
  dark: {
    background: '0.145 0.012 290',
    foreground: '0.985 0 0',
    card: '0.145 0.012 290',
    cardForeground: '0.985 0 0',
    popover: '0.145 0.012 290',
    popoverForeground: '0.985 0 0',
    primary: '0.69 0.17 290',
    primaryForeground: '0.205 0 0',
    secondary: '0.269 0.012 290',
    secondaryForeground: '0.985 0 0',
    muted: '0.269 0.012 290',
    mutedForeground: '0.708 0.012 290',
    accent: '0.269 0.012 290',
    accentForeground: '0.985 0 0',
    destructive: '0.396 0.141 25.723',
    destructiveForeground: '0.971 0.013 17.38',
    warning: '0.82 0.13 80',
    warningForeground: '0.27 0.05 75',
    info: '0.65 0.18 245',
    infoForeground: '0.15 0.01 240',
    success: '0.8 0.14 150',
    successForeground: '0.27 0.05 150',
    destructiveText: '0.68 0.19 27.325',
    warningText: '0.8 0.16 75',
    infoText: '0.7 0.16 240',
    successText: '0.73 0.2 150',
    overlay: '0.145 0.012 290',
    border: '0.269 0.012 290',
    input: '0.48 0.012 290',
    ring: '0.69 0.17 290',
    chart1: '0.64 0.16 290',
    chart2: '0.66 0.13 70',
    chart3: '0.62 0.13 170',
    chart4: '0.54 0.19 30',
    chart5: '0.58 0.13 235',
  },
} as const

export type ColorScheme = keyof typeof themeTokens.colors
export type Palette = (typeof themeTokens.colors)[ColorScheme]
