import { fireEvent, render } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { initMobileI18n } from '@/lib/i18n'
import { themeTokens } from '@/theme/tokens'

import { ReportCurrencyPicker } from './report-currency-picker'

const palette = themeTokens.colors.light

const renderWithI18n = async (node: React.ReactElement) => {
  const i18n = await initMobileI18n('en')
  return render(<I18nextProvider i18n={i18n}>{node}</I18nextProvider>)
}

describe('ReportCurrencyPicker', () => {
  it('shows "Any currency" when unset, and the selected code once chosen', async () => {
    const view = await renderWithI18n(<ReportCurrencyPicker currencies={['EUR', 'USD']} selected={undefined} onChange={jest.fn()} palette={palette} />)
    expect(view.getByLabelText('Currency, Any currency')).toBeTruthy()

    const withSelection = await renderWithI18n(<ReportCurrencyPicker currencies={['EUR', 'USD']} selected="EUR" onChange={jest.fn()} palette={palette} />)
    expect(withSelection.getByLabelText('Currency, EUR')).toBeTruthy()
  })

  it('selects a currency and can clear back to "any"', async () => {
    const onChange = jest.fn()
    const view = await renderWithI18n(<ReportCurrencyPicker currencies={['EUR', 'USD']} selected={undefined} onChange={onChange} palette={palette} />)
    await fireEvent.press(view.getByRole('button', { name: 'Currency, Any currency' }))
    await fireEvent.press(view.getByRole('button', { name: 'USD' }))
    expect(onChange).toHaveBeenCalledWith('USD')

    const withSelection = await renderWithI18n(<ReportCurrencyPicker currencies={['EUR', 'USD']} selected="USD" onChange={onChange} palette={palette} />)
    await fireEvent.press(withSelection.getByRole('button', { name: 'Currency, USD' }))
    await fireEvent.press(withSelection.getByRole('button', { name: 'Any currency' }))
    expect(onChange).toHaveBeenCalledWith(undefined)
  })
})
