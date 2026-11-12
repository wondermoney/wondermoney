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
     * One scale, read off the web app's Tailwind classes at phone width (web
     * `DESIGN.md` is upstream): body 16, data-surface text 14 (`text-sm`),
     * helper text 12 (`text-xs`), page title 24/600, ruled section head
     * 18/600, and Geist Mono figures at 48 lead, 36 object, 24 stat, 18 and
     * 16 secondary, 14 row and 12 small. A screen that needs a size not listed here is telling you a role
     * is missing, not that the scale is too small.
     */
    scale: {
      /** The page's lead figure (web `font-mono text-5xl font-medium tracking-tight`). Mono. */
      display: { fontFamily: dataFontFamily, fontSize: 48, lineHeight: 60, letterSpacing: -1.2, fontWeight: '500' },
      /** An object's key figure (web ObjectHeader `text-4xl`). Mono. */
      figure: { fontFamily: dataFontFamily, fontSize: 36, lineHeight: 44, letterSpacing: -0.9, fontWeight: '500' },
      /** A stat cell's value (web StatCard `text-2xl font-medium`). Mono. */
      stat: { fontFamily: dataFontFamily, fontSize: 24, lineHeight: 32, letterSpacing: -0.6, fontWeight: '500' },
      /** Page title (web `text-2xl font-semibold tracking-tight`). One per screen. */
      title: { fontFamily: interfaceFontFamily, fontSize: 24, lineHeight: 32, letterSpacing: -0.6, fontWeight: '600' },
      /**
       * An open section's head (`Section variant="open"`): 20/600, full
       * foreground. Space above it separates sections instead of a rule.
       */
      heading: { fontFamily: interfaceFontFamily, fontSize: 20, lineHeight: 28, letterSpacing: -0.4, fontWeight: '600' },
      /** Ruled section head (web Section `text-lg font-semibold`). */
      section: { fontFamily: interfaceFontFamily, fontSize: 18, lineHeight: 28, letterSpacing: -0.45, fontWeight: '600' },
      /** A lead figure's name, a group title (web `text-base font-medium`). */
      subheading: { fontFamily: interfaceFontFamily, fontSize: 16, lineHeight: 24, letterSpacing: 0, fontWeight: '500' },
      /** Paragraphs and standalone copy (web body, 16px). */
      body: { fontFamily: interfaceFontFamily, fontSize: 16, lineHeight: 24, letterSpacing: 0, fontWeight: '400' },
      bodyStrong: { fontFamily: interfaceFontFamily, fontSize: 16, lineHeight: 24, letterSpacing: 0, fontWeight: '500' },
      /** Data-surface text: stat labels, tab labels, descriptions (web `text-sm`). */
      meta: { fontFamily: interfaceFontFamily, fontSize: 14, lineHeight: 20, letterSpacing: 0, fontWeight: '400' },
      /** A list row's name, a small heading (web `text-sm font-medium`). */
      metaStrong: { fontFamily: interfaceFontFamily, fontSize: 14, lineHeight: 20, letterSpacing: 0, fontWeight: '500' },
      /** Helper lines, row meta, comparisons (web `text-xs`). Sentence case, never tracked. */
      label: { fontFamily: interfaceFontFamily, fontSize: 12, lineHeight: 16, letterSpacing: 0, fontWeight: '400' },
      /** Control labels (web button `text-sm font-medium`). */
      action: { fontFamily: interfaceFontFamily, fontSize: 14, lineHeight: 20, letterSpacing: 0, fontWeight: '500' },
      /**
       * A secondary figure (web `font-mono text-lg`): home's You own / You owe and
       * a budget's "left", a budget lead's Spent / Planned, portfolio metrics.
       * Web's weight here runs 400–600 by page; mobile settles on 500. Mono.
       */
      amountLarge: { fontFamily: dataFontFamily, fontSize: 18, lineHeight: 28, letterSpacing: 0, fontWeight: '500' },
      /** A change line under a lead figure (web NetWorthHero `font-mono text-base`). Mono. */
      amountBase: { fontFamily: dataFontFamily, fontSize: 16, lineHeight: 24, letterSpacing: 0, fontWeight: '400' },
      /** Figures inside a row (web `font-mono text-sm`). Mono. */
      amount: { fontFamily: dataFontFamily, fontSize: 14, lineHeight: 20, letterSpacing: 0, fontWeight: '500' },
      /** A figure on a secondary line or a comparison (web `font-mono text-xs`). Mono. */
      amountSmall: { fontFamily: dataFontFamily, fontSize: 12, lineHeight: 16, letterSpacing: 0, fontWeight: '400' },
    },
    /**
     * Older role names, retuned onto the scale above so code reading `roles.*`
     * picks up the scale too; new code uses `scale` directly.
     *
     * @deprecated use `typography.scale`
     */
    roles: {
      interface: { fontFamily: interfaceFontFamily, fontSize: 16, lineHeight: 24, letterSpacing: 0 },
      data: { fontFamily: dataFontFamily, fontSize: 14, lineHeight: 20, letterSpacing: 0 },
      caption: { fontFamily: interfaceFontFamily, fontSize: 12, lineHeight: 16, letterSpacing: 0 },
      pageTitle: { fontFamily: interfaceFontFamily, fontSize: 24, lineHeight: 32, letterSpacing: -0.6 },
      sectionTitle: { fontFamily: interfaceFontFamily, fontSize: 18, lineHeight: 28, letterSpacing: -0.45 },
      action: { fontFamily: interfaceFontFamily, fontSize: 14, lineHeight: 20, letterSpacing: 0 },
    },
  },
  /**
   * Web's `DESIGN.md` is upstream: every mobile target is at least 44pt (WCAG
   * 2.2 AA and the platforms' own floor). The 48pt house value the port
   * started with is retired — the phone now matches the web app at phone
   * width, where controls draw at 40 and the bottom bar at 64.
   *
   * A control drawn smaller than `minimum` (a 40pt button, a 32pt segment)
   * makes up the difference with `hitSlop`; the tests assert drawn + slop.
   */
  touchTarget: {
    minimum: 44,
    comfortable: 48,
    wcagFloor: 44,
  },
  /**
   * Drawn sizes taken from web's Tailwind classes at phone width.
   *
   * `control` is web's `h-10` (buttons, selects, inputs); `controlSmall` its
   * `h-9`. The shell values are `TopBar.tsx` (`h-16`, tabs `h-11`) and
   * `BottomNav.tsx` (`h-16`).
   */
  size: {
    control: 40,
    controlSmall: 36,
    topBar: 64,
    sectionTab: 44,
    bottomBar: 64,
    /** Web's `size-8` avatar in the person menu trigger. */
    avatar: 32,
    /** lucide `size-4` / `size-5` equivalents for SF Symbols. */
    iconSmall: 16,
    icon: 20,
  },
  /**
   * `EntityMark`: the leading square on a row that names a thing (a category,
   * an account's institution, a ticker). `md` for list rows, `sm` for dense
   * rows, option sheets and form values.
   * `logoBacking` is deliberately the same white in both halves: third-party
   * logos assume a light backing (many are a dark glyph on transparency), so
   * web's `FinancialAssetLogo` forces `bg-white` and so does mobile.
   */
  mark: {
    md: 36,
    sm: 24,
    logoBacking: '#ffffff',
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
    /**
     * Web's `shadow-xs`: the selected segment of a segmented control only. It
     * lifts the chosen segment off the muted track; it is not a card shadow.
     */
    xs: {
      shadowColor: '#000000',
      shadowOpacity: 0.06,
      shadowRadius: 1,
      shadowOffset: { width: 0, height: 1 },
      elevation: 1,
    },
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

/**
 * The merchant avatar fallback: an initial on a colour picked by hashing the
 * merchant's normalized name (`features/merchants/merchant-avatar-model.ts`), so a
 * merchant has the same colour on every screen, on web and on mobile.
 *
 * The order is shared with web (`web/theme/globals.css`, `--merchant-*`) and
 * must not change: 0 blue, 1 teal, 2 amber, 3 fuchsia, 4 sky, 5 orange,
 * 6 stone, 7 slate. No slot is red or green (those mean money lost and gained)
 * or brand violet (the accent's seven places only; web `DESIGN.md`).
 * A pale fill under a dark ink of the same hue in light, a
 * deep fill under a pale ink in dark. `merchantAvatarSources` holds web's
 * OKLCH; `merchant-avatar-model.test.ts` reconverts it, checks every pair
 * clears 4.5:1 in both halves, that a slot keeps its hue, and that no hue falls
 * in the reserved bands. Change the OKLCH, never the hex.
 */
export const merchantAvatarSources = {
  light: [
    { hue: 'blue', background: '0.93 0.03 255', foreground: '0.45 0.1 255' },
    { hue: 'teal', background: '0.93 0.045 195', foreground: '0.45 0.075 195' },
    { hue: 'amber', background: '0.93 0.045 85', foreground: '0.45 0.09 85' },
    { hue: 'fuchsia', background: '0.93 0.04 335', foreground: '0.45 0.11 335' },
    { hue: 'sky', background: '0.93 0.035 230', foreground: '0.45 0.085 230' },
    { hue: 'orange', background: '0.93 0.035 50', foreground: '0.45 0.1 50' },
    { hue: 'stone', background: '0.93 0.012 60', foreground: '0.45 0.025 60' },
    { hue: 'slate', background: '0.93 0.012 260', foreground: '0.45 0.025 260' },
  ],
  dark: [
    { hue: 'blue', background: '0.34 0.06 255', foreground: '0.9 0.045 255' },
    { hue: 'teal', background: '0.34 0.055 195', foreground: '0.9 0.05 195' },
    { hue: 'amber', background: '0.34 0.06 85', foreground: '0.9 0.05 85' },
    { hue: 'fuchsia', background: '0.34 0.06 335', foreground: '0.9 0.05 335' },
    { hue: 'sky', background: '0.34 0.055 230', foreground: '0.9 0.045 230' },
    { hue: 'orange', background: '0.34 0.06 50', foreground: '0.9 0.05 50' },
    { hue: 'stone', background: '0.34 0.015 60', foreground: '0.9 0.012 60' },
    { hue: 'slate', background: '0.34 0.015 260', foreground: '0.9 0.012 260' },
  ],
} as const

export type MerchantAvatarColors = Readonly<{ background: string; foreground: string }>

/** The committed sRGB of `merchantAvatarSources`, slot for slot. */
export const merchantAvatarColors: Readonly<Record<ColorScheme, readonly MerchantAvatarColors[]>> = {
  light: [
    { background: '#dbe9fc', foreground: '#2b568b' },
    { background: '#c6f2f1', foreground: '#076262' },
    { background: '#f6e6c7', foreground: '#6c5005' },
    { background: '#fadef3', foreground: '#793b6d' },
    { background: '#d1edfb', foreground: '#0e5d7b' },
    { background: '#fce2d4', foreground: '#80421a' },
    { background: '#eee6e0', foreground: '#605248' },
    { background: '#e3e8f0', foreground: '#4d5664' },
  ],
  dark: [
    { background: '#223956', foreground: '#cbe0fc' },
    { background: '#064141', foreground: '#b8e9e8' },
    { background: '#46350d', foreground: '#eddcb9' },
    { background: '#4b2b44', foreground: '#f4d2eb' },
    { background: '#133d4f', foreground: '#c1e4f7' },
    { background: '#512e1a', foreground: '#fbd5c1' },
    { background: '#3e3630', foreground: '#e4dcd6' },
    { background: '#333840', foreground: '#d9dee6' },
  ],
}
