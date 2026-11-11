import { fireEvent, render } from '@testing-library/react-native'
import { Alert } from 'react-native'
import { I18nextProvider } from 'react-i18next'

import { initMobileI18n } from '@/lib/i18n'

import { TransactionSplitScreen, type TransactionSplitScreenProps } from './transaction-split-screen'
import { mapTransactions } from './transactions-view-model'
import { transactionFixture } from './test-fixtures'

const categories = [
  { id: 3, name: 'Groceries', system: true, color: null, glyph: '□', countsAsSpending: true, children: [] },
  { id: 4, name: 'Household', system: false, color: null, glyph: '□', countsAsSpending: true, children: [] },
]

const debitRow = (overrides: Partial<typeof transactionFixture> = {}) => mapTransactions({ transactions: [{
  ...transactionFixture,
  appuserSettlementAmount: -100,
  settlementAmount: -100,
  settlementCurrencyKey: { code: 'EUR' },
  appuserCurrencyKey: { code: 'EUR' },
  ...overrides,
}] })[0]!

const savedSplit = [
  { transactionSplitKey: 1, amount: -60, appuserAmount: -60, category: { categoryKey: 3, name: 'Groceries', isSystemCategory: true }, notes: null, position: 0 },
  { transactionSplitKey: 2, amount: -40, appuserAmount: -40, category: { categoryKey: 4, name: 'Household', isSystemCategory: false }, notes: 'Soap', position: 1 },
]

async function renderScreen(overrides: Partial<TransactionSplitScreenProps> = {}, language = 'en') {
  const i18n = await initMobileI18n(language)
  const props: TransactionSplitScreenProps = {
    transaction: debitRow(),
    categories,
    locale: language,
    onClose: jest.fn(),
    onSave: jest.fn(),
    onRemove: jest.fn(),
    ...overrides,
  }
  const view = await render(<I18nextProvider i18n={i18n}><TransactionSplitScreen {...props} /></I18nextProvider>)
  return { view, props }
}

describe('split editor', () => {
  it('starts a new split with the row’s category and the whole amount, and saves only when the lines balance', async () => {
    const { view, props } = await renderScreen()
    expect(view.getByRole('header', { name: 'Split transaction' })).toBeOnTheScreen()
    expect(view.getByLabelText('Amount for line 1')).toHaveDisplayValue('')
    expect(view.getByLabelText('Amount for line 2')).toHaveDisplayValue('')
    expect(view.getByTestId('transaction-split-save')).toBeDisabled()
    expect(view.getByText('Remaining to assign')).toBeOnTheScreen()

    await fireEvent.changeText(view.getByLabelText('Amount for line 1'), '60')
    await fireEvent.changeText(view.getByLabelText('Amount for line 2'), '40')
    expect(view.getByText('Fully assigned')).toBeOnTheScreen()
    expect(view.getByTestId('transaction-split-save')).toBeEnabled()

    await fireEvent.press(view.getByTestId('transaction-split-save'))
    expect(props.onSave).toHaveBeenCalledWith([
      { amount: '-60', categoryId: 3, notes: null },
      { amount: '-40', categoryId: null, notes: null },
    ])
  })

  it('blocks saving while a line is blank or unreadable, and says which line is wrong', async () => {
    const { view } = await renderScreen()
    await fireEvent.changeText(view.getByLabelText('Amount for line 1'), '60')
    expect(view.getByTestId('transaction-split-save')).toBeDisabled()
    expect(view.getByText('Give every line an amount.')).toBeOnTheScreen()

    await fireEvent.changeText(view.getByLabelText('Amount for line 2'), 'abc')
    expect(view.getByText('Enter an amount or a percentage.')).toBeOnTheScreen()
    expect(view.getByTestId('transaction-split-save')).toBeDisabled()
  })

  it('adds and removes lines, never dropping below two', async () => {
    const { view } = await renderScreen()
    expect(view.getByRole('button', { name: 'Remove line 1' })).toBeDisabled()
    await fireEvent.press(view.getByRole('button', { name: 'Add line' }))
    expect(view.getByLabelText('Amount for line 3')).toBeOnTheScreen()
    expect(view.getByRole('button', { name: 'Remove line 3' })).toBeEnabled()
    await fireEvent.press(view.getByRole('button', { name: 'Remove line 3' }))
    expect(view.queryByLabelText('Amount for line 3')).not.toBeOnTheScreen()
  })

  it('splits the amount evenly over the lines', async () => {
    const { view } = await renderScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Split evenly' }))
    expect(view.getByLabelText('Amount for line 1')).toHaveDisplayValue('50')
    expect(view.getByLabelText('Amount for line 2')).toHaveDisplayValue('50')
    expect(view.getByText('Fully assigned')).toBeOnTheScreen()
  })

  it('opens an existing split with its lines, and removes it only after confirmation', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined)
    const { view, props } = await renderScreen({ transaction: debitRow({ splits: savedSplit }) })
    expect(view.getByLabelText('Amount for line 1')).toHaveDisplayValue('60')
    expect(view.getByLabelText('Amount for line 2')).toHaveDisplayValue('40')
    // Nothing has changed yet, so there is nothing to save.
    expect(view.getByTestId('transaction-split-save')).toBeDisabled()

    await fireEvent.press(view.getByRole('button', { name: 'Remove split' }))
    expect(alert).toHaveBeenCalledWith('Remove the split?', expect.stringContaining('Groceries'), expect.any(Array))
    const buttons = alert.mock.calls[0]![2] as { text: string; onPress?: () => void }[]
    buttons.find((button) => button.text === 'Remove split')?.onPress?.()
    expect(props.onRemove).toHaveBeenCalledTimes(1)
    alert.mockRestore()
  })

  it('shows a failed save and keeps the editor open', async () => {
    const { view } = await renderScreen({ error: 'The split could not be saved.' })
    expect(view.getByText('The split could not be saved.')).toBeOnTheScreen()
    expect(view.getByRole('header', { name: 'Split transaction' })).toBeOnTheScreen()
  })

  it('speaks the editor in the app’s language', async () => {
    const { view } = await renderScreen({}, 'pt-PT')
    expect(view.getByRole('header', { name: 'Dividir transação' })).toBeOnTheScreen()
    expect(view.getByText('Falta atribuir')).toBeOnTheScreen()
    expect(view.getByRole('button', { name: 'Adicionar linha' })).toBeOnTheScreen()
  })
})
