import { fireEvent, render, waitFor } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { initMobileI18n } from '@/lib/i18n'
import { themeTokens } from '@/theme/tokens'

import { PortfolioTransactionCreateScreen, type PortfolioTransactionCreateScreenProps } from './portfolio-transaction-create-screen'

// The debounced query itself is covered by the markets tests; here it answers
// one deterministic match for any typed term.
const mockSearch = jest.fn((term: string) => ({ isFetching: false, data: term.trim() ? { results: [{ symbol: 'AAPL', exchange: 'NASDAQ', name: 'Apple Inc.', currency: 'USD', type: 'Common Stock' }] } : undefined }))
jest.mock('@/features/markets/use-ticker-search', () => ({ useTickerSearch: (term: string) => mockSearch(term) }))

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

/** Opens a select row's sheet and picks one option. */
const choose = async (view: Awaited<ReturnType<typeof renderScreen>>['view'], field: string, option: string) => {
  await fireEvent.press(view.getByRole('button', { name: new RegExp(`^${field},`) }))
  await fireEvent.press(view.getByRole('radio', { name: option }))
}

async function pickAsset(view: Awaited<ReturnType<typeof renderScreen>>['view']) {
  await fireEvent.changeText(view.getByLabelText('Asset'), 'aapl')
  await fireEvent.press(view.getByRole('button', { name: 'Apple Inc., AAPL, NASDAQ' }))
}

async function fillRequiredFields(view: Awaited<ReturnType<typeof renderScreen>>['view']) {
  await fireEvent.press(view.getByRole('tab', { name: 'Buy' }))
  await pickAsset(view)
  await fireEvent.changeText(view.getByLabelText('Quantity'), '10')
  await fireEvent.changeText(view.getByLabelText('Unit price'), '150.25')
  await fireEvent.changeText(view.getByLabelText('Transaction date'), '2026-08-01')
  await choose(view, 'Settlement currency', 'EUR · Euro')
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

  it('records a sell when Sell is chosen, accepting a comma as the decimal point', async () => {
    const onCreate = jest.fn().mockResolvedValue(undefined)
    const { view } = await renderScreen({ onCreate })
    await fillRequiredFields(view)
    await fireEvent.press(view.getByRole('tab', { name: 'Sell' }))
    await fireEvent.changeText(view.getByLabelText('Unit price'), '150,25')
    await fireEvent.press(view.getByRole('button', { name: 'Add transaction' }))
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ financialTransactionTypeId: 2, unitPrice: '150.25' })))
  })

  it('reads numbers in the app language: 1,000 shares in English are a thousand', async () => {
    const onCreate = jest.fn().mockResolvedValue(undefined)
    const { view } = await renderScreen({ onCreate })
    await fillRequiredFields(view)
    await fireEvent.changeText(view.getByLabelText('Quantity'), '1,000')
    await fireEvent.changeText(view.getByLabelText('Unit price'), '1,234.5')
    await fireEvent.press(view.getByRole('button', { name: 'Add transaction' }))
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ quantity: '1000', unitPrice: '1234.5' })))
  })

  it('shows an error instead of saving a price it cannot read', async () => {
    const onCreate = jest.fn()
    const { view } = await renderScreen({ onCreate })
    await fillRequiredFields(view)
    await fireEvent.changeText(view.getByLabelText('Unit price'), '1.2.3')
    expect(view.getByRole('button', { name: 'Add transaction' })).toBeDisabled()
    expect(onCreate).not.toHaveBeenCalled()
  })

  it('keeps Buy | Sell as the segments and puts every other type behind a Type row', async () => {
    const onCreate = jest.fn().mockResolvedValue(undefined)
    const fiveTypes = [...transactionTypes, { financialTransactionTypeKey: 3, name: 'DEPOSIT' }, { financialTransactionTypeKey: 4, name: 'WITHDRAWAL' }, { financialTransactionTypeKey: 5, name: 'OFFER' }]
    const { view } = await renderScreen({ onCreate, transactionTypes: fiveTypes })
    expect(view.getAllByRole('tab').map((tab) => tab.props.accessibilityLabel)).toEqual(['Buy', 'Sell'])
    await fillRequiredFields(view)
    await choose(view, 'Transaction type', 'Deposit')
    expect(view.getByRole('button', { name: 'Transaction type, Deposit' })).toBeOnTheScreen()
    expect(view.getByRole('tab', { name: 'Buy' })).not.toBeSelected()
    await fireEvent.press(view.getByRole('button', { name: 'Add transaction' }))
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ financialTransactionTypeId: 3 })))
  })

  it('starts on Buy, picked by name, even when the types arrive after the first render in another order', async () => {
    const onCreate = jest.fn().mockResolvedValue(undefined)
    const reordered = [{ financialTransactionTypeKey: 3, name: 'DEPOSIT' }, { financialTransactionTypeKey: 2, name: 'SELL' }, { financialTransactionTypeKey: 1, name: 'BUY' }]
    const { view, props } = await renderScreen({ onCreate, loading: true, transactionTypes: [] })
    const i18n = await initMobileI18n('en')
    await view.rerender(<I18nextProvider i18n={i18n}><PortfolioTransactionCreateScreen {...props} loading={false} transactionTypes={reordered} /></I18nextProvider>)
    expect(view.getByRole('tab', { name: 'Buy' })).toBeSelected()
    expect(view.getByRole('button', { name: 'Transaction type, Buy' })).toBeOnTheScreen()
    await pickAsset(view)
    await fireEvent.changeText(view.getByLabelText('Quantity'), '1')
    await fireEvent.changeText(view.getByLabelText('Unit price'), '10')
    await choose(view, 'Settlement currency', 'EUR · Euro')
    await fireEvent.press(view.getByRole('button', { name: 'Add transaction' }))
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ financialTransactionTypeId: 1 })))
  })

  it('shows no Type row when Buy and Sell are the only types', async () => {
    const { view } = await renderScreen()
    expect(view.queryByRole('button', { name: /^Transaction type,/ })).toBeNull()
  })

  it('lets a picked asset be changed back to a search field', async () => {
    const { view } = await renderScreen()
    await pickAsset(view)
    await fireEvent.press(view.getByRole('button', { name: 'Asset, AAPL' }))
    expect(view.getByLabelText('Asset')).toHaveDisplayValue('')
  })

  it('records a dividend with its share count and per-share payment', async () => {
    const onCreate = jest.fn().mockResolvedValue(undefined)
    const { view } = await renderScreen({ onCreate, transactionTypes: [...transactionTypes, { financialTransactionTypeKey: 3, name: 'DIVIDEND' }] })
    await fillRequiredFields(view)
    await choose(view, 'Transaction type', 'Dividend')
    await fireEvent.changeText(view.getByLabelText('Dividend per share'), '0.25')
    await fireEvent.press(view.getByRole('button', { name: 'Add transaction' }))
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ financialTransactionTypeId: 3, quantity: '10', unitPrice: '0.25' })))
  })

  it('keeps Add transaction disabled until the required fields are filled, flagging only wrong input', async () => {
    const onCreate = jest.fn()
    const { view } = await renderScreen({ onCreate })
    expect(view.getByRole('button', { name: 'Add transaction' })).toBeDisabled()
    expect(view.queryByText('Enter a quantity greater than 0.')).not.toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Add transaction' }))
    expect(onCreate).not.toHaveBeenCalled()
  })

  it('shows an error under a wrong value and clears it once fixed', async () => {
    const { view } = await renderScreen()
    await fireEvent.changeText(view.getByLabelText('Quantity'), '0')
    expect(view.getByText('Enter a quantity greater than 0.')).toBeOnTheScreen()
    await fireEvent.changeText(view.getByLabelText('Quantity'), '10')
    expect(view.queryByText('Enter a quantity greater than 0.')).not.toBeOnTheScreen()
    await fireEvent.changeText(view.getByLabelText('Transaction date'), '2026-8-1')
    expect(view.getByText('Enter a valid date (YYYY-MM-DD).')).toBeOnTheScreen()
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
    expect(view.getByRole('button', { name: 'Saving…' })).toBeDisabled()
    expect(view.getByRole('button', { name: 'Close' })).toBeDisabled()
  })

  it('preselects the portfolio-native currency when one is given', async () => {
    const { view } = await renderScreen({ defaultCurrencyId: 2 })
    expect(view.getByRole('button', { name: 'Settlement currency, USD · US Dollar' })).toBeOnTheScreen()
  })
})
