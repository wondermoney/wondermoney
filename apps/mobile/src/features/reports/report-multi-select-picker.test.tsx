import { fireEvent, render } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { initMobileI18n } from '@/lib/i18n'
import { themeTokens } from '@/theme/tokens'

import { ReportMultiSelectPicker } from './report-multi-select-picker'

const palette = themeTokens.colors.light
const options = [{ id: '1', label: 'Checking' }, { id: '2', label: 'Savings' }]

const renderWithI18n = async (node: React.ReactElement) => {
  const i18n = await initMobileI18n('en')
  return render(<I18nextProvider i18n={i18n}>{node}</I18nextProvider>)
}

describe('ReportMultiSelectPicker', () => {
  it('shows an "any" placeholder when nothing is selected, and a count once something is', async () => {
    const view = await renderWithI18n(<ReportMultiSelectPicker label="Accounts" options={options} selected={[]} onChange={jest.fn()} palette={palette} />)
    expect(view.getByLabelText('Accounts, Any')).toBeTruthy()

    const withSelection = await renderWithI18n(<ReportMultiSelectPicker label="Accounts" options={options} selected={['1']} onChange={jest.fn()} palette={palette} />)
    expect(withSelection.getByLabelText('Accounts, 1 selected')).toBeTruthy()
  })

  it('expands on press, adds and removes an option from the selection, and filters by search', async () => {
    const onChange = jest.fn()
    const view = await renderWithI18n(<ReportMultiSelectPicker label="Accounts" options={options} selected={[]} onChange={onChange} palette={palette} />)
    await fireEvent.press(view.getByRole('button', { name: 'Accounts, Any' }))
    expect(view.getByText('Checking')).toBeOnTheScreen()
    expect(view.getByText('Savings')).toBeOnTheScreen()

    await fireEvent.press(view.getByRole('checkbox', { name: 'Checking' }))
    expect(onChange).toHaveBeenCalledWith(['1'])

    await fireEvent.changeText(view.getByLabelText('Search Accounts'), 'Sav')
    expect(view.queryByText('Checking')).toBeNull()
    expect(view.getByText('Savings')).toBeOnTheScreen()
  })

  it('clears the whole selection via the clear-all action', async () => {
    const onChange = jest.fn()
    const view = await renderWithI18n(<ReportMultiSelectPicker label="Accounts" options={options} selected={['1', '2']} onChange={onChange} palette={palette} />)
    await fireEvent.press(view.getByRole('button', { name: 'Accounts, 2 selected' }))
    await fireEvent.press(view.getByRole('button', { name: 'Clear all' }))
    expect(onChange).toHaveBeenCalledWith([])
  })

  it('shows an honest no-results message for a search with no matches', async () => {
    const view = await renderWithI18n(<ReportMultiSelectPicker label="Accounts" options={options} selected={[]} onChange={jest.fn()} palette={palette} />)
    await fireEvent.press(view.getByRole('button', { name: 'Accounts, Any' }))
    await fireEvent.changeText(view.getByLabelText('Search Accounts'), 'zzz')
    expect(view.getByText('No results found')).toBeOnTheScreen()
  })
})
