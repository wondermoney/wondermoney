import { fireEvent, render, waitFor } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'
import { Pressable as MockPressable, Text as MockText } from 'react-native'

import { initMobileI18n } from '@/lib/i18n'
import { themeTokens } from '@/theme/tokens'

import { PortfolioTransactionCreateScreen, type PortfolioTransactionCreateScreenProps } from './portfolio-transaction-create-screen'

// Debounced ticker search is exercised by its own dedicated test at
// portfolio-ticker-search-field.test.tsx; here it's stubbed to a single deterministic pick so the
// form-level tests stay focused on the create flow itself.
jest.mock('./portfolio-ticker-search-field', () => ({
  PortfolioTickerSearchField: ({ label, onSelect }: { label: string; onSelect: (result: { symbol: string }) => void }) => (
    <MockPressable accessibilityRole="button" accessibilityLabel={label} onPress={() => onSelect({ symbol: 'AAPL' })}>
      <MockText>{label}</MockText>
    </MockPressable>
  ),
}))

const palette = themeTokens.colors.light
const transactionTypes = [{ financialTransactionTypeKey: 1, name: 'BUY' }, { financialTransactionTypeKey: 2, name: 'SELL' }]
const currencies = [{ currencyKey: 1, code: 'EUR', description: 'Euro' }, { currencyKey: 2, code: 'USD', description: 'US Dollar' }]

const renderScreen = async (overrides: Partial<PortfolioTransactionCreateScreenProps> = {}) => {
  const i18n = await initMobileI18n('en')
  const props: PortfolioTransactionCreateScreenProps = {
    transactionTypes, currencies, defaultCurrencyId: null, loading: false, metadataError: false, pending: false, outcome: null, palette,
    onBack: jest.fn(), onCreate: jest.fn().mockResolvedValue(undefined), ...overrides,
  }
  return { props, view: await render(<I18nextProvider i18n={i18n}><PortfolioTransactionCreateScreen {...props} /></I18nextProvider>) }
}

async function fillRequiredFields(view: Awaited<ReturnType<typeof renderScreen>>['view']) {
  await fireEvent.press(view.getByRole('radio', { name: 'Buy' }))
  await fireEvent.press(view.getByRole('button', { name: 'Asset *' }))
  await fireEvent.changeText(view.getByLabelText('Quantity'), '10')
  await fireEvent.changeText(view.getByLabelText('Unit price'), '150.25')
  await fireEvent.changeText(view.getByLabelText('Transaction date'), '2026-08-01')
  await fireEvent.press(view.getByRole('radio', { name: 'EUR · Euro' }))
}

describe('PortfolioTransactionCreateScreen', () => {
  it('submits the full payload once every required field is filled', async () => {
    const onCreate = jest.fn().mockResolvedValue(undefined)
    const { view } = await renderScreen({ onCreate })
    await fillRequiredFields(view)
    await fireEvent.press(view.getByRole('button', { name: 'Add transaction' }))
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith({
      assetSymbol: 'AAPL', financialTransactionTypeId: 1, notes: '', quantity: '10', settlementCurrencyId: 1, transactionDate: '2026-08-01', unitPrice: '150.25',
    }))
  })

  it('lets a picked asset be changed back to a search field', async () => {
    const { view } = await renderScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Asset *' }))
    expect(view.getByLabelText('Asset: AAPL')).toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Change' }))
    expect(view.getByRole('button', { name: 'Asset *' })).toBeOnTheScreen()
  })

  it('never offers DIVIDEND as a selectable type', async () => {
    const { view } = await renderScreen()
    expect(view.queryByRole('radio', { name: /dividend/i })).toBeNull()
  })

  it('shows a per-field error under each missing required field and never calls onCreate', async () => {
    const onCreate = jest.fn()
    const { view } = await renderScreen({ onCreate })
    // Transaction date defaults to today, so it's the one required field
    // that's already valid on a fresh, untouched form.
    await fireEvent.press(view.getByRole('button', { name: 'Add transaction' }))
    expect(await view.findByText('Choose a transaction type.')).toBeOnTheScreen()
    expect(view.getByText('Search for and select an asset.')).toBeOnTheScreen()
    expect(view.getByText('Enter a quantity greater than 0.')).toBeOnTheScreen()
    expect(view.getByText('Enter a unit price greater than 0.')).toBeOnTheScreen()
    expect(view.getByText('Choose a settlement currency.')).toBeOnTheScreen()
    expect(view.queryByText('Enter a valid date (YYYY-MM-DD).')).not.toBeOnTheScreen()
    expect(onCreate).not.toHaveBeenCalled()
  })

  it('clears a field error once that field is fixed', async () => {
    const onCreate = jest.fn()
    const { view } = await renderScreen({ onCreate })
    await fireEvent.press(view.getByRole('button', { name: 'Add transaction' }))
    expect(await view.findByText('Enter a quantity greater than 0.')).toBeOnTheScreen()
    await fireEvent.changeText(view.getByLabelText('Quantity'), '10')
    expect(view.queryByText('Enter a quantity greater than 0.')).not.toBeOnTheScreen()
  })

  it('surfaces a server-side outcome as a distinct alert', async () => {
    const { view } = await renderScreen({ outcome: 'invalid' })
    expect(view.getByRole('alert')).toHaveTextContent(/check the transaction details/i)
  })

  it('shows loading and metadata-error states before transaction types/currencies resolve', async () => {
    const loading = await renderScreen({ loading: true })
    expect(loading.view.getByRole('progressbar')).toBeOnTheScreen()
    const failed = await renderScreen({ loading: false, metadataError: true })
    expect(failed.view.getByRole('alert')).toHaveTextContent(/could not load the details/i)
  })

  it('locks every field and the submit action while pending', async () => {
    const { view } = await renderScreen({ pending: true })
    expect(view.getByLabelText('Quantity').props.editable).toBe(false)
    expect(view.getByRole('button', { name: 'Saving…' }).props.accessibilityState.disabled).toBe(true)
  })

  it('preselects the portfolio-native currency when one is given', async () => {
    const { view } = await renderScreen({ defaultCurrencyId: 2 })
    expect(view.getByRole('radio', { name: 'USD · US Dollar' }).props.accessibilityState.checked).toBe(true)
  })
})
