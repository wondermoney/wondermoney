import { render } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'
import { StyleSheet } from 'react-native'

import { initMobileI18n } from '@/lib/i18n'
import { themeTokens } from '@/theme/tokens'

import { Amount, MISSING, MixedAmount } from './amount'

const palette = themeTokens.colors.light

/** `Amount` reaches i18n for its absence and mixed-aggregate strings. */
async function renderLocalised(node: React.ReactElement, locale = 'en') {
  const i18n = await initMobileI18n(locale)
  return render(<I18nextProvider i18n={i18n}>{node}</I18nextProvider>)
}

describe('Amount', () => {
  it('sets the currency in muted ink and the figure in foreground ink', async () => {
    const view = await render(<Amount currency="EUR" locale="en" value={11250} />)

    // `Intl` returns one atomic string; the split is what lets the eye ignore a
    // token that is identical on every row.
    const currency = view.getByText('€')
    expect(StyleSheet.flatten(currency.props.style).color).toBe(palette.mutedForeground)
  })

  it('follows the locale for symbol position rather than a template', async () => {
    const en = await render(<Amount currency="EUR" locale="en-US" value={1234.5} />)
    const pt = await render(<Amount currency="EUR" locale="pt-PT" value={1234.5} />)

    const read = (view: typeof en) =>
      view.getByLabelText(/1[.,]?2?3?4/).props.accessibilityLabel as string

    // en prefixes, pt suffixes. Neither is hardcoded.
    expect(read(en).trim().startsWith('€')).toBe(true)
    expect(read(pt).trim().endsWith('€')).toBe(true)
  })

  it('renders an absence as an em-dash, never as zero', async () => {
    const view = await render(<Amount currency="EUR" locale="en" value={null} />)
    expect(view.getByText(MISSING)).toBeTruthy()
    expect(view.queryByText(/0[.,]00/)).toBeNull()
  })

  it('does not colour a balance by its sign', async () => {
    const negative = await render(<Amount currency="EUR" locale="en" value={-11.51} />)
    const positive = await render(<Amount currency="EUR" locale="en" value={11.51} />)

    const colorOf = (view: typeof negative, label: RegExp) =>
      StyleSheet.flatten(view.getByLabelText(label).props.style).color

    // The minus sign communicates the sign. Red and green are spent on
    // exceptional status, not on the everyday fact that an expense is negative.
    expect(colorOf(negative, /11[.,]51/)).toBe(palette.foreground)
    expect(colorOf(positive, /11[.,]51/)).toBe(palette.foreground)
    expect(colorOf(negative, /11[.,]51/)).not.toBe(palette.destructiveText)
  })

  it('colours a delta, and gives it an explicit sign', async () => {
    const up = await render(<Amount currency="EUR" delta locale="en" value={42} />)
    const down = await render(<Amount currency="EUR" delta locale="en" value={-42} />)

    const label = (view: typeof up) => view.getByLabelText(/42/).props.accessibilityLabel as string
    const color = (view: typeof up) => StyleSheet.flatten(view.getByLabelText(/42/).props.style).color

    expect(color(up)).toBe(palette.successText)
    expect(color(down)).toBe(palette.destructiveText)
    // Colour never acts alone.
    expect(label(up)).toContain('+')
    expect(label(down)).toContain('-')
  })

  it('survives a malformed currency code instead of taking the screen down', async () => {
    const view = await render(<Amount currency="NOT_A_CODE" locale="en" value={10} />)
    expect(view.getByText('NOT_A_CODE')).toBeTruthy()
  })

  it('names a mixed aggregate rather than summing it', async () => {
    const view = await renderLocalised(<MixedAmount currencyCount={2} />)
    // Rendering a plausible-but-wrong total is worse than rendering none.
    expect(view.getByText('2 currencies')).toBeTruthy()
  })

  it('reads the absence string from the active locale', async () => {
    const view = await renderLocalised(<Amount currency="EUR" locale="pt-PT" value={null} />, 'pt-PT')
    expect(view.getByLabelText('Indisponível')).toBeTruthy()
  })
})
