import { act, fireEvent, render } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'

import { initMobileI18n } from '@/lib/i18n'
import { themeTokens } from '@/theme/tokens'

import { Amount } from './amount'
import { AmountEntry } from './amount-entry'
import { FloatingActionButton, FLOATING_ACTION_SIZE } from './floating-action-button'
import { FormBar } from './form-bar'
import { FORM_ROW_HEIGHT, FormGroup, FormSelectRow, FormSwitchRow, FormTextRow } from './form-row'
import { HeadlineFigure } from './headline-figure'
import { ObjectHeader } from './page-header'
import { Section } from './section'
import { SegmentedControl } from './segmented-control'
import { StatCell, StatColumns } from './stat'

const palette = themeTokens.colors.light
const scale = themeTokens.typography.scale

async function renderLocalised(node: React.ReactElement, locale = 'en') {
  const i18n = await initMobileI18n(locale)
  return render(<I18nextProvider i18n={i18n}>{node}</I18nextProvider>)
}

describe('FormBar', () => {
  it('closes on the left and saves on the right in violet, disabled until valid and busy while saving', async () => {
    const close = jest.fn()
    const save = jest.fn()
    const view = await render(<FormBar closeLabel="Close" onClose={close} onSave={save} saveDisabled saveLabel="Save" title="New account" />)
    expect(view.getByRole('header', { name: 'New account' })).toBeOnTheScreen()
    expect(view.getByRole('button', { name: 'Save' })).toBeDisabled()
    await fireEvent.press(view.getByRole('button', { name: 'Close' }))
    expect(close).toHaveBeenCalled()

    await view.rerender(<FormBar closeLabel="Close" onClose={close} onSave={save} saveLabel="Save" saving />)
    expect(view.getByRole('button', { name: 'Save' }).props.accessibilityState).toMatchObject({ disabled: true, busy: true })

    await view.rerender(<FormBar closeLabel="Close" onClose={close} onSave={save} saveLabel="Save" />)
    await fireEvent.press(view.getByRole('button', { name: 'Save' }))
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('gives every glyph a 44pt target', async () => {
    const view = await render(<FormBar closeLabel="Close" onClose={jest.fn()} onSave={jest.fn()} saveLabel="Save" />)
    for (const name of ['Close', 'Save']) {
      const style = StyleSheet.flatten(view.getByRole('button', { name }).props.style)
      expect(style.width).toBeGreaterThanOrEqual(themeTokens.touchTarget.minimum)
      expect(style.height).toBeGreaterThanOrEqual(themeTokens.touchTarget.minimum)
    }
  })
})

describe('FloatingActionButton', () => {
  it('is a 56pt violet circle with its own name', async () => {
    const add = jest.fn()
    const view = await render(<FloatingActionButton accessibilityLabel="Add transaction" onPress={add} />)
    const button = view.getByRole('button', { name: 'Add transaction' })
    const style = StyleSheet.flatten(button.props.style)
    expect(style).toMatchObject({ position: 'absolute', width: FLOATING_ACTION_SIZE, height: FLOATING_ACTION_SIZE, backgroundColor: palette.primary })
    await fireEvent.press(button)
    expect(add).toHaveBeenCalled()
  })
})

describe('FormRow', () => {
  it('reads as "label, value", shows the placeholder when empty, and opens its choices', async () => {
    const change = jest.fn()
    const view = await render(
      <FormGroup>
        <FormSelectRow accessibilityLabel="Category (optional)" label="Category" onChange={change} options={[{ value: 1, label: 'Food' }]} placeholder="None" value={null} />
        <FormTextRow accessibilityLabel="Merchant name or search" label="Merchant" onChangeText={jest.fn()} placeholder="Name or search" value="" />
      </FormGroup>,
    )
    const row = view.getByRole('button', { name: 'Category (optional), None' })
    expect(StyleSheet.flatten(view.getByText('None').props.style).color).toBe(palette.mutedForeground)
    expect(StyleSheet.flatten(row.props.style).minHeight).toBe(56)
    await fireEvent.press(row)
    await fireEvent.press(view.getByRole('radio', { name: 'Food' }))
    expect(change).toHaveBeenCalledWith(1)
    expect(view.getByLabelText('Merchant name or search')).toBeOnTheScreen()
  })

  it('puts an error under its row', async () => {
    const view = await render(<FormTextRow error="Too long" label="Note" onChangeText={jest.fn()} value="x" />)
    expect(view.getByRole('alert')).toHaveTextContent('Too long')
  })
})

describe('FormSwitchRow', () => {
  // The row the label sits in: the nearest host ancestor drawn at the row height.
  type Node = { props: { style?: StyleProp<ViewStyle> }; parent: Node | null }
  const rowOf = (node: Node) => {
    let current: Node | null = node
    while (current && StyleSheet.flatten(current.props.style)?.minHeight !== FORM_ROW_HEIGHT) current = current.parent
    if (!current) throw new Error('no row')
    return current
  }
  const rowStyle = (label: Node) => StyleSheet.flatten(rowOf(label).props.style) ?? {}

  it('names the switch, exposes its state, and toggles from the switch or anywhere on the row', async () => {
    const onValueChange = jest.fn()
    const view = await render(<FormGroup><FormSwitchRow accessibilityLabel="Private account" hint="Only you see it" label="Private" onValueChange={onValueChange} value={false} /></FormGroup>)
    const control = view.getByRole('switch', { name: 'Private account' })
    expect(control).not.toBeChecked()
    expect(control.props.accessibilityState).toMatchObject({ checked: false, disabled: false })
    expect(view.getByText('Only you see it')).toBeOnTheScreen()
    expect(rowStyle(view.getByText('Private')).minHeight).toBe(FORM_ROW_HEIGHT)

    await fireEvent.press(view.getByText('Private'))
    expect(onValueChange).toHaveBeenLastCalledWith(true)
    await fireEvent(control, 'valueChange', true)
    expect(onValueChange).toHaveBeenCalledTimes(2)

    await view.rerender(<FormSwitchRow label="Private" onValueChange={onValueChange} value />)
    expect(view.getByRole('switch', { name: 'Private' })).toBeChecked()
    await fireEvent.press(view.getByText('Private'))
    expect(onValueChange).toHaveBeenLastCalledWith(false)
  })

  it('ignores presses when disabled and says so', async () => {
    const onValueChange = jest.fn()
    const view = await render(<FormSwitchRow disabled label="Include ETFs" onValueChange={onValueChange} value={false} />)
    const control = view.getByRole('switch', { name: 'Include ETFs' })
    expect(control).toBeDisabled()
    expect(control.props.accessibilityState).toMatchObject({ checked: false, disabled: true })
    await fireEvent.press(view.getByText('Include ETFs'))
    expect(onValueChange).not.toHaveBeenCalled()
    expect(rowStyle(view.getByText('Include ETFs')).opacity).toBe(0.5)
  })

  it('rings the row while the switch has focus', async () => {
    const view = await render(<FormSwitchRow label="Include ETFs" onValueChange={jest.fn()} value={false} />)
    const style = () => rowStyle(view.getByText('Include ETFs'))
    // Driven through the prop, as for Button: RNTL's focus event does not reach it.
    await act(async () => view.getByRole('switch').props.onFocus({ nativeEvent: {} }))
    expect(style().borderColor).toBe(palette.ring)
    await act(async () => view.getByRole('switch').props.onBlur({ nativeEvent: {} }))
    expect(style().borderColor).toBeUndefined()
  })
})

describe('AmountEntry', () => {
  it('takes the amount on a decimal keypad, with the currency where the locale puts it', async () => {
    const change = jest.fn()
    const en = await render(<AmountEntry accessibilityLabel="Amount" currency="EUR" locale="en" onChangeText={change} value="" />)
    const input = en.getByLabelText('Amount')
    expect(input.props.keyboardType).toBe('decimal-pad')
    expect(input.props.placeholder).toBe('0')
    expect(StyleSheet.flatten(input.props.style).fontFamily).toBe(scale.display.fontFamily)
    await fireEvent.changeText(input, '12,5a')
    expect(change).toHaveBeenCalledWith('12,5')
    expect(en.getByText('€')).toBeOnTheScreen()
  })
})

describe('HeadlineFigure', () => {
  it('sets the cents smaller on the same line, and puts a status after the label', async () => {
    const view = await renderLocalised(
      <HeadlineFigure currency="EUR" label="Net worth" labelIsHeader locale="en" status={{ label: 'Balances updated 2 days ago' }} value={136530.67} />,
    )
    expect(view.getByRole('header', { name: 'Net worth' })).toBeOnTheScreen()
    expect(view.getByText('Balances updated 2 days ago')).toBeOnTheScreen()
    const cents = view.getByText('.67')
    expect(StyleSheet.flatten(cents.props.style)).toMatchObject({ fontSize: Math.round(scale.display.fontSize * 0.55), lineHeight: scale.display.lineHeight })
    // The reading stays the whole figure.
    expect(view.getByLabelText('€136,530.67')).toBeOnTheScreen()
  })

  it('splits on the locale’s decimal separator', async () => {
    const view = await renderLocalised(<Amount currency="EUR" locale="pt-PT" size="display" split value={1234.5} />, 'pt-PT')
    expect(view.getByText(',50')).toBeOnTheScreen()
  })
})

describe('Section variant open', () => {
  it('has no rule and a 20/600 heading', async () => {
    const view = await render(<Section testID="open" title="This month" variant="open"><></></Section>)
    expect(StyleSheet.flatten(view.getByRole('header', { name: 'This month' }).props.style)).toMatchObject({ fontSize: 20, fontWeight: '600', color: palette.foreground })
    expect(StyleSheet.flatten(view.getByTestId('open').props.style).borderTopWidth).toBeUndefined()
  })
})

describe('form row labels', () => {
  it('never truncate: the label keeps its natural width and the value shrinks', async () => {
    const view = await render(
      <FormGroup>
        <FormSelectRow label="Monthly contribution target" onChange={jest.fn()} options={[{ value: 1, label: 'A very long chosen value that must give way' }]} placeholder="None" value={1} />
        <FormTextRow label="Opening/current balance" onChangeText={jest.fn()} value="" />
      </FormGroup>,
    )
    for (const label of ['Monthly contribution target', 'Opening/current balance']) {
      const node = view.getByText(label)
      expect(node.props.numberOfLines).toBeUndefined()
      expect(StyleSheet.flatten(node.props.style)).toMatchObject({ flexShrink: 0 })
    }
    expect(StyleSheet.flatten(view.getByText('A very long chosen value that must give way').props.style)).toMatchObject({ flex: 1, minWidth: 0 })
    expect(StyleSheet.flatten(view.getByLabelText('Opening/current balance').props.style)).toMatchObject({ flex: 1, minWidth: 0 })
  })
})

describe('SegmentedControl', () => {
  it('keeps every label on one line, shrinking the font instead of breaking a word', async () => {
    const view = await render(
      <SegmentedControl accessibilityLabel="Type" fill onChange={jest.fn()} options={[{ value: 'b', label: 'Buy' }, { value: 'w', label: 'Withdrawal' }]} value="b" />,
    )
    const label = view.getByText('Withdrawal')
    expect(label.props.numberOfLines).toBe(1)
    expect(label.props.adjustsFontSizeToFit).toBe(true)
  })
})

describe('ObjectHeader', () => {
  it('keeps the action at the end of the title row: the row never wraps and the title shrinks', async () => {
    const view = await render(
      <ObjectHeader action={<View testID="action" />} leading={<View />} title="Millennium Conta Ordenado with a long name" />,
    )
    const action = view.getByTestId('action')
    const row = action.parent?.parent
    expect(StyleSheet.flatten(row?.props.style)).toMatchObject({ flexDirection: 'row', alignItems: 'center' })
    expect(StyleSheet.flatten(row?.props.style).flexWrap).toBeUndefined()
    expect(StyleSheet.flatten(action.parent?.props.style)).toMatchObject({ flexShrink: 0 })
  })
})

describe('StatColumns', () => {
  it('lays two or three stats in one row of equal columns, and four as a 2×2 grid', async () => {
    const three = await render(
      <StatColumns testID="three">
        <StatCell currency="EUR" label="Target" locale="en" value={60417.06} />
        <StatCell label="Active" locale="en">5</StatCell>
        <StatCell label="Funded" locale="en">2</StatCell>
      </StatColumns>,
    )
    const cells = three.getByTestId('three').children as unknown as { props: { style: StyleProp<ViewStyle> } }[]
    expect(cells).toHaveLength(3)
    for (const cell of cells) expect(StyleSheet.flatten(cell.props.style)).toMatchObject({ flex: 1 })
    expect(StyleSheet.flatten(three.getByText('5').props.style)).toMatchObject({ fontSize: scale.amountBase.fontSize })
    // A value never wraps: one line, shrinking to fit its column.
    for (const node of [three.getByText('5'), three.getByLabelText('€60,417.06')]) {
      expect(node.props.numberOfLines).toBe(1)
      expect(node.props.adjustsFontSizeToFit).toBe(true)
      expect(node.props.minimumFontScale).toBeGreaterThanOrEqual(0.5)
    }
    await three.unmount()

    const four = await render(
      <StatColumns testID="four">
        {['A', 'B', 'C', 'D'].map((label) => <StatCell key={label} label={label} locale="en">1</StatCell>)}
      </StatColumns>,
    )
    for (const cell of four.getByTestId('four').children as unknown as { props: { style: StyleProp<ViewStyle> } }[]) {
      expect(StyleSheet.flatten(cell.props.style)).toMatchObject({ width: '47%' })
    }
  })
})
