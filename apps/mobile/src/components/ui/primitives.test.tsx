import { fireEvent, render } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'
import { StyleSheet } from 'react-native'

import { initMobileI18n } from '@/lib/i18n'
import { themeTokens } from '@/theme/tokens'

import { Amount } from './amount'
import { Badge } from './badge'
import { Banner } from './banner'
import { StatCard } from './card'
import { List, ListRow } from './list-row'
import { SegmentedControl } from './segmented-control'
import { EmptyState, Section } from './section'

const palette = themeTokens.colors.light

async function renderLocalised(node: React.ReactElement) {
  const i18n = await initMobileI18n('en')
  return render(<I18nextProvider i18n={i18n}>{node}</I18nextProvider>)
}

describe('StatCard', () => {
  it('leaves the headline figure in foreground ink', async () => {
    const view = await renderLocalised(<StatCard currency="EUR" label="Net worth" locale="en" value={-12000} />)
    // The previous implementation took a `tone` prop and painted the value red
    // or green. A balance is not a status.
    expect(StyleSheet.flatten(view.getByLabelText(/12[.,]000/).props.style).color).toBe(palette.foreground)
  })

  it('derives the delta direction from the delta, not from optimism', async () => {
    // The previous implementation painted every `delta` with the positive
    // colour, so a loss rendered green.
    const down = await renderLocalised(
      <StatCard currency="EUR" delta={-250} label="Net worth" locale="en" value={12000} />,
    )
    expect(StyleSheet.flatten(down.getByLabelText(/250/).props.style).color).toBe(palette.destructiveText)

    const up = await renderLocalised(<StatCard currency="EUR" delta={250} label="Net worth" locale="en" value={12000} />)
    expect(StyleSheet.flatten(up.getByLabelText(/250/).props.style).color).toBe(palette.successText)
  })

  it('carries a comparison beside the headline figure', async () => {
    const view = await renderLocalised(
      <StatCard
        comparison={{ label: 'Last month', value: 11556.34 }}
        currency="EUR"
        label="Gross volume"
        locale="en"
        value={12198.72}
      />,
    )
    expect(view.getByText('Last month')).toBeTruthy()
    expect(view.getByLabelText(/11[.,]556/)).toBeTruthy()
  })

  it('withholds a comparison it cannot make honestly', async () => {
    const view = await renderLocalised(
      <StatCard comparison={{ label: 'Last month', value: null }} currency="EUR" label="Total" locale="en" value={10} />,
    )
    expect(view.queryByText('Last month')).toBeNull()
  })
})

describe('Badge', () => {
  it('states the status as a word, with its own foreground', async () => {
    const view = await render(<Badge label="Overdue" tone="destructive" />)
    const label = view.getByText('Overdue')

    expect(StyleSheet.flatten(label.props.style).color).toBe(palette.destructiveForeground)
  })
})

describe('Banner', () => {
  it('uses the quiet register — semantic ink and border on the plain surface', async () => {
    const view = await render(<Banner message="We could not refresh two accounts." title="Out of date" tone="warning" />)
    const surface = view.getByRole('summary')
    const style = StyleSheet.flatten(surface.props.style)

    // No surface tint: a `-text` token on a 5% fill of its own hue measured
    // under 4.5:1 on the web half, and at 10% all three semantic tones failed.
    expect(style.backgroundColor).toBe(palette.card)
    expect(style.borderColor).toBe(palette.warningText)
  })

  it('announces a destructive banner as an alert', async () => {
    const view = await render(<Banner message="Sync failed." tone="destructive" />)
    expect(view.getByRole('alert')).toBeTruthy()
  })
})

describe('ListRow', () => {
  it('stacks facts in a left column with the figure right-aligned', async () => {
    const view = await renderLocalised(
      <List>
        <ListRow
          figure={<Amount currency="EUR" locale="en" value={-11.51} />}
          meta={['Bank One · Current account', 'Mar 7']}
          title="Supermarket"
        />
      </List>,
    )

    expect(view.getByText('Supermarket')).toBeTruthy()
    expect(view.getByText('Bank One · Current account')).toBeTruthy()
    expect(view.getByText('Mar 7')).toBeTruthy()
  })

  it('drops absent meta lines rather than rendering blanks', async () => {
    const view = await render(<ListRow meta={['Bank One', null, undefined]} title="Supermarket" />)
    expect(view.queryByText('')).toBeNull()
    expect(view.getByText('Bank One')).toBeTruthy()
  })

  it('keeps each line to one, so the row height does not vary with content', async () => {
    const view = await render(<ListRow meta={['A very long institution name that would otherwise wrap']} title="Supermarket" />)
    expect(view.getByText('Supermarket').props.numberOfLines).toBe(1)
  })

  it('meets the touch target when it is interactive', async () => {
    const onPress = jest.fn()
    const view = await render(<ListRow onPress={onPress} title="Supermarket" />)
    const row = view.getByRole('button', { name: 'Supermarket' })

    expect(StyleSheet.flatten(row.props.style).minHeight).toBeGreaterThanOrEqual(themeTokens.touchTarget.wcagFloor)
    fireEvent.press(row)
    expect(onPress).toHaveBeenCalledTimes(1)
  })
})

describe('SegmentedControl', () => {
  const options = [
    { label: 'Month', value: 'month' },
    { label: '30 days', value: '30-days' },
  ] as const

  it('spends the accent on the selected segment only', async () => {
    const view = await render(
      <SegmentedControl accessibilityLabel="Period" onChange={jest.fn()} options={options} value="month" />,
    )

    const style = (name: string) => StyleSheet.flatten(view.getByLabelText(name).props.style)
    expect(style('Month').backgroundColor).toBe(palette.primaryWash)
    // The app previously drew every segment with its own border, which is how
    // a screen ends up with a row of separate boxes instead of one control —
    // now there's one shared border around the track (see the `tablist`
    // element), not a per-segment border color.
    expect(style('30 days').backgroundColor).toBe('transparent')
  })

  it('stays 48pt to the finger even though it draws at 34', async () => {
    // The compact chip is only safe because `hitSlop` makes up the difference.
    // If someone "tidies up" the hitSlop, this is what catches it.
    const view = await render(
      <SegmentedControl accessibilityLabel="Period" onChange={jest.fn()} options={options} value="month" />,
    )
    const chip = view.getByLabelText('Month')
    const drawn = StyleSheet.flatten(chip.props.style).minHeight as number
    const slop = chip.props.hitSlop as { top: number; bottom: number }

    expect(drawn + slop.top + slop.bottom).toBeGreaterThanOrEqual(themeTokens.touchTarget.minimum)
  })

  it('announces selection rather than leaving it to colour', async () => {
    const onChange = jest.fn()
    const view = await render(
      <SegmentedControl accessibilityLabel="Period" onChange={onChange} options={options} value="month" />,
    )

    expect(view.getByLabelText('Month').props.accessibilityState).toMatchObject({ selected: true })
    expect(view.getByLabelText('30 days').props.accessibilityState).toMatchObject({ selected: false })

    fireEvent.press(view.getByLabelText('30 days'))
    expect(onChange).toHaveBeenCalledWith('30-days')
  })
})

describe('Section and EmptyState', () => {
  it('renders a section head as a header at the section scale', async () => {
    const view = await render(
      <Section title="Top categories">
        <></>
      </Section>,
    )
    const head = view.getByRole('header', { name: 'Top categories' })
    expect(StyleSheet.flatten(head.props.style)).toMatchObject({
      fontSize: themeTokens.typography.scale.section.fontSize,
    })
  })

  it('gives an empty state a preview of the real thing', async () => {
    const view = await renderLocalised(
      <EmptyState
        message="Add one to get started."
        preview={<Amount currency="EUR" locale="en" value={3280.5} />}
        title="No accounts yet"
      />,
    )
    expect(view.getByRole('header', { name: 'No accounts yet' })).toBeTruthy()
    expect(view.getByLabelText(/3[.,]280/)).toBeTruthy()
  })
})
