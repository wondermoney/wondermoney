import { I18nextProvider } from 'react-i18next'
import { fireEvent, render } from '@testing-library/react-native'
import { StyleSheet } from 'react-native'

import { initMobileI18n } from '@/lib/i18n'
import { themeTokens } from '@/theme/tokens'

import { DateField, formatIsoDate, parseIsoDate } from './date-field'

describe('ISO calendar dates', () => {
  it('parses YYYY-MM-DD as the local calendar day, not UTC midnight', () => {
    const date = parseIsoDate('2026-03-01')
    expect(date?.getFullYear()).toBe(2026)
    expect(date?.getMonth()).toBe(2)
    expect(date?.getDate()).toBe(1)
    expect(formatIsoDate(date as Date)).toBe('2026-03-01')
  })

  it('rejects malformed and impossible dates', () => {
    expect(parseIsoDate('2026-02-30')).toBeNull()
    expect(parseIsoDate('01/03/2026')).toBeNull()
    expect(parseIsoDate('')).toBeNull()
    expect(parseIsoDate(null)).toBeNull()
  })
})

describe('DateField (text fallback used in tests and on web)', () => {
  it('passes typed text through and hands back null when emptied', async () => {
    const i18n = await initMobileI18n('en')
    const onChange = jest.fn()
    const view = await render(<I18nextProvider i18n={i18n}><DateField label="Target date" onChange={onChange} value="2026-01-01" /></I18nextProvider>)
    const input = view.getByLabelText('Target date')

    await fireEvent.changeText(input, '2026-06-30')
    expect(onChange).toHaveBeenLastCalledWith('2026-06-30')
    await fireEvent.changeText(input, '  ')
    expect(onChange).toHaveBeenLastCalledWith(null)
  })

  it('offers a clear action only when optional and set', async () => {
    const i18n = await initMobileI18n('en')
    const onChange = jest.fn()
    const view = await render(<I18nextProvider i18n={i18n}><DateField label="End date" onChange={onChange} optional value="2026-01-01" /></I18nextProvider>)
    await fireEvent.press(view.getByRole('button', { name: 'Clear date' }))
    expect(onChange).toHaveBeenCalledWith(null)

    await view.rerender(<I18nextProvider i18n={i18n}><DateField label="End date" onChange={onChange} value="2026-01-01" /></I18nextProvider>)
    expect(view.queryByRole('button', { name: 'Clear date' })).toBeNull()
  })

  it('shows the error under the field and swaps the boundary to destructive', async () => {
    const i18n = await initMobileI18n('en')
    const view = await render(<I18nextProvider i18n={i18n}><DateField error="Pick a future date" label="Target date" onChange={jest.fn()} testID="date" value={null} /></I18nextProvider>)
    expect(view.getByText('Pick a future date')).toBeTruthy()
    const box = view.getByTestId('date-input').parent
    let node = box
    while (node && StyleSheet.flatten(node.props.style)?.borderWidth == null) node = node.parent
    expect(StyleSheet.flatten(node?.props.style).borderColor).toBe(themeTokens.colors.light.destructiveText)
  })
})
