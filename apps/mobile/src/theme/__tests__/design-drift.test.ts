import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * The regression guard for the parts of `DESIGN.md` a type-checker cannot see.
 *
 * Every rule below is here because the codebase broke it at scale before the
 * port — 23 ad-hoc font sizes, 40 balances coloured by sign, 30 page subtitles,
 * 10 uppercase micro-labels. Those are all cheap to reintroduce one at a time
 * and expensive to find by eye, which is exactly what a guard is for.
 *
 * Each check reports **every** offending file, not just the first, so a fix is
 * one pass rather than a game of whack-a-mole. Where a rule has legitimate
 * exceptions they are listed explicitly with the reason, not silently skipped.
 */

const ROOT = path.resolve(__dirname, '../../..')

/** Production `.tsx`/`.ts` under `src/`, excluding tests and fixtures. */
function productionFiles(): string[] {
  const out = execFileSync('git', ['ls-files', 'src'], { cwd: ROOT, encoding: 'utf8' })
  return out
    .split('\n')
    .filter((file: string) => Boolean(file))
    .filter((file: string) => /\.tsx?$/.test(file))
    .filter((file: string) => !/\.test\.tsx?$/.test(file))
    .filter((file: string) => !file.includes('__tests__'))
    .filter((file: string) => !file.includes('test-fixtures'))
}

function read(file: string): string {
  return readFileSync(path.join(ROOT, file), 'utf8')
}

/** Collect `file:line` for every line matching `pattern`. */
function findAll(pattern: RegExp, exclude: string[] = []): string[] {
  const hits: string[] = []
  for (const file of productionFiles()) {
    if (exclude.some((e) => file.includes(e))) continue
    read(file)
      .split('\n')
      .forEach((line, index) => {
        if (pattern.test(line)) hits.push(`${file}:${index + 1}`)
        pattern.lastIndex = 0
      })
  }
  return hits
}

describe('design system drift', () => {
  it('declares type through the scale, never an ad-hoc size', () => {
    // The app carried 23 distinct literal `fontSize` values. A screen needing a
    // size the scale does not have is telling you a role is missing.
    const offenders = findAll(/\bfontSize:\s*\d+/, [
      'src/theme/tokens.ts', // the scale itself
      'src/constants/theme.ts', // scaffold leftover, tracked as accepted debt
      'src/components/themed-text.tsx', // same
    ])
    expect(offenders).toEqual([])
  })

  it('has no uppercase, letterspaced micro-labels', () => {
    // Sentence case, `label` role, muted. The app had three house styles for
    // the same marker; the system has one.
    expect(findAll(/textTransform:\s*'uppercase'/)).toEqual([])
  })

  it('does not colour an amount by its sign', () => {
    // The `financial.positive` / `financial.negative` aliases are gone. Their
    // reappearance would mean the balance-colouring came back with them.
    expect(findAll(/\bfinancial\.(positive|negative)\b/)).toEqual([])
  })

  it('does not render a page subtitle', () => {
    // A supporting sentence under a page title is furniture. Object descriptors
    // go on `ObjectHeader`; form instructions go on `instruction`; facts about
    // the data go on `provenance`.
    expect(findAll(/\bsubtitle=/, ['src/components/ui/page-header.tsx'])).toEqual([])
  })

  it('reads colour from the palette, never from a literal', () => {
    const offenders = findAll(/(['"])#[0-9a-fA-F]{3,8}\1|\brgba?\(/, [
      'src/theme/tokens.ts',
      // Accepted debt / not-debt, each recorded in DESIGN_HISTORY.md's Accepted debt table:
      'src/constants/theme.ts', //          scaffold token source, unused
      'src/components/themed-text.tsx', //  scaffold component, unused
      'src/components/animated-icon.tsx', // scaffold component, unused
      'src/features/auth/social-sign-in-buttons.tsx', // Google brand marks
      'src/features/categories/category-manage-screen.tsx', // persisted data default
      'src/features/categories/category-manage-route.tsx', //  same
      'src/features/reports/spending-by-category-report-view-model.ts', // "Other" bucket
    ])
    expect(offenders).toEqual([])
  })

  it('has retired every deprecated palette alias', () => {
    // These aliased the real tokens so the port could land incrementally. A
    // reappearance means someone copied a pre-port screen.
    expect(
      findAll(/\bpalette\.(surface|surfaceMuted|surfaceElevated|textMuted|separator|interaction|interactionMuted|budget)\b/),
    ).toEqual([])
    expect(findAll(/\bpalette\.text\b/)).toEqual([])
  })

  it('does not re-declare the Palette type per file', () => {
    // 44 files had their own structurally-identical copy.
    expect(findAll(/^type Palette = \(typeof themeTokens/)).toEqual([])
  })

  it('spaces from the scale, never from a raw pixel value', () => {
    // Four screens declared `padding: 24` / `gap: 16` as bare numbers, which is
    // why every token-based sweep of the density pass walked straight past
    // them and they kept the old spacing while the rest of the app tightened.
    const offenders = findAll(
      /\b(?:padding|paddingHorizontal|paddingVertical|paddingTop|paddingBottom|gap|rowGap|columnGap): (?:1[2-9]|[2-9]\d)\b/,
      ['src/theme/tokens.ts'],
    )
    expect(offenders).toEqual([])
  })

  it('does not nest a virtualized list inside a scroll view', () => {
    // React Native warns about this because it silently disables
    // virtualization. In the manual-account form it meant an empty search
    // rendered all ~1000 institutions into a ScrollView, and the warning
    // itself rendered on top of the app.
    const offenders = productionFiles().filter((file) => {
      const source = read(file)
      return /<ScrollView/.test(source) && /<FlatList|<SectionList|<VirtualizedList/.test(source)
    })
    expect(offenders).toEqual([])
  })

  it('does not paint a chart series with the accent', () => {
    // `--primary` and `--chart-1` are both violet 290, so a series drawn with
    // the accent is indistinguishable from slot 1 — the cash-flow legend had
    // Income and Net in the same colour. A series takes a chart slot.
    const offenders = findAll(/<(?:Line|Scatter|Area|Bar|BarGroup\.Bar)\b[^>]*color=\{palette\.primary\}/)
    expect(offenders).toEqual([])
  })

  it('keeps every card border-defined rather than shadowed', () => {
    // Depth is border-first. `shadow.overlay` is the only shadow, and it is for
    // sheets, dialogs and popovers.
    const offenders = findAll(/themeTokens\.shadow\.(?!overlay\b)\w+/)
    expect(offenders).toEqual([])
  })
})
