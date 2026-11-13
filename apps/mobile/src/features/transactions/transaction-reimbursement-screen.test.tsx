import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, waitFor } from '@testing-library/react-native'
import { Alert } from 'react-native'
import { I18nextProvider } from 'react-i18next'

import { ApiError } from '@/lib/api/errors'
import { initMobileI18n } from '@/lib/i18n'

import type { LinkedTransactionDto, ReimbursementLinkDto, ReimbursementSuggestionDto, TransactionReimbursementsDto } from './reimbursements-contract'
import { TransactionReimbursementScreen, SUGGESTION_SEARCH_DELAY_MS } from './transaction-reimbursement-screen'
import { mapTransactions } from './transactions-view-model'
import { transactionFixture } from './test-fixtures'

const mockRead = jest.fn()
const mockWrite = jest.fn()
const mockBlockAccess = jest.fn()

jest.mock('@/components/providers/product-runtime-provider', () => ({
  useProductRuntime: () => ({ runtime: { epochId: 3, apiClient: { read: mockRead, write: mockWrite } }, blockAccess: mockBlockAccess }),
}))

const refund = mapTransactions({ transactions: [{
  ...transactionFixture,
  transactionKey: 90,
  transactionTypeKey: { name: 'credit' },
  transactionMerchantKey: { name: 'Corner shop' },
  settlementAmount: 20,
  appuserSettlementAmount: 20,
}] })[0]!

const side = (overrides: Partial<LinkedTransactionDto> = {}): LinkedTransactionDto => ({
  transactionKey: 41,
  accountKey: 7,
  accountName: 'Daily account',
  description: 'Card purchase',
  merchantName: 'Corner shop',
  transactionDate: '2026-07-10T10:00:00.000Z',
  settlementAmount: -50,
  currencyCode: 'EUR',
  ...overrides,
})

const suggestion = (overrides: Partial<ReimbursementSuggestionDto> = {}): ReimbursementSuggestionDto => ({
  ...side(),
  remainingAmount: 50,
  reason: 'merchant',
  ...overrides,
})

const existingLink: ReimbursementLinkDto = {
  transactionReimbursementKey: 5,
  amount: 8,
  currencyCode: 'EUR',
  createdAt: '2026-07-20T10:00:00.000Z',
  expense: side({ transactionKey: 44, merchantName: 'Pharmacy', description: null, settlementAmount: -8 }),
  reimbursement: side({ transactionKey: 90, merchantName: 'Corner shop', settlementAmount: 20 }),
}

type Api = Readonly<{
  links?: TransactionReimbursementsDto
  suggestions?: (search: string) => ReimbursementSuggestionDto[]
}>

function serve(api: Api = {}) {
  const links = api.links ?? { role: 'reimbursement', currencyCode: 'EUR', linkedAmount: 0, remainingAmount: 20, links: [] }
  mockRead.mockImplementation(async (endpoint: { path: string }) => {
    const url = new URL(endpoint.path, 'https://api.test')
    if (url.pathname.endsWith('/reimbursements/suggestions')) {
      const search = url.searchParams.get('search') ?? ''
      return { suggestions: api.suggestions ? api.suggestions(search) : [suggestion(), suggestion({ transactionKey: 42, merchantName: 'Big store', description: 'Shoes', settlementAmount: -12, remainingAmount: 12, reason: 'amount' })] }
    }
    if (url.pathname.endsWith('/reimbursements')) return links
    throw new Error(`Unexpected read ${endpoint.path}`)
  })
}

async function renderScreen(onClose = jest.fn(), language = 'en') {
  const i18n = await initMobileI18n(language)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: 0 } } })
  const view = await render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <TransactionReimbursementScreen locale={language} onClose={onClose} transaction={refund} />
      </I18nextProvider>
    </QueryClientProvider>,
  )
  return { view, onClose, client }
}

beforeEach(() => {
  mockRead.mockReset()
  mockWrite.mockReset()
  mockBlockAccess.mockReset()
})

describe('Mark as reimbursement', () => {
  it('lists suggested expenses with the same-merchant hint and says which currency can be linked', async () => {
    serve()
    const { view, client } = await renderScreen()
    expect(view.getByRole('header', { name: 'Mark as reimbursement' })).toBeOnTheScreen()
    expect(await view.findByRole('radio', { name: /^Corner shop, -€50.00, Jul 10 · Daily account, Same merchant$/ })).toBeOnTheScreen()
    expect(view.getByRole('radio', { name: /^Shoes|^Big store/ })).toBeOnTheScreen()
    expect(view.getByText('Same merchant')).toBeOnTheScreen()
    expect(view.getByText('Only expenses in EUR can be linked for now.')).toBeOnTheScreen()
    expect(mockRead).toHaveBeenCalledWith(expect.objectContaining({ path: '/v1/account/transaction/90/reimbursements/suggestions?limit=10' }))
    expect(view.getByTestId('transaction-reimbursement-save')).toBeDisabled()
    client.clear()
  })

  it('defaults the amount to what is left on both sides, then links the chosen expense', async () => {
    serve()
    mockWrite.mockImplementation(async (_endpoint, options: { commit: (value: unknown) => void }) => {
      options.commit(undefined)
      return { link: { ...existingLink, transactionReimbursementKey: 9, amount: 12 } }
    })
    const { view, onClose, client } = await renderScreen()
    const invalidate = jest.spyOn(client, 'invalidateQueries')

    // The refund has 20 left; this expense only 12, so 12 it is.
    await fireEvent.press(await view.findByRole('radio', { name: /^Big store/ }))
    expect(view.getByLabelText('Amount to link')).toHaveDisplayValue('12')
    expect(view.getByText('Up to €12.00: what is left of this reimbursement and of the expense.')).toBeOnTheScreen()

    // The larger expense caps at what is left of the refund.
    await fireEvent.press(view.getByRole('radio', { name: /^Corner shop/ }))
    expect(view.getByLabelText('Amount to link')).toHaveDisplayValue('20')
    await fireEvent.changeText(view.getByLabelText('Amount to link'), '25')
    expect(view.getByText('At most €20.00 can be linked.')).toBeOnTheScreen()
    expect(view.getByTestId('transaction-reimbursement-save')).toBeDisabled()

    await fireEvent.changeText(view.getByLabelText('Amount to link'), '12.5')
    expect(view.getByTestId('transaction-reimbursement-save')).toBeEnabled()
    await fireEvent.press(view.getByTestId('transaction-reimbursement-save'))

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(mockWrite).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'POST', path: '/v1/account/transaction/90/reimbursements' }),
      expect.objectContaining({ body: { expenseTransactionId: 41, amount: 12.5 } }),
    )
    // The same queries a split change refreshes: the lists (and their links), budgets, reports.
    const predicate = (invalidate.mock.calls[0]![0] as { predicate: (query: { queryKey: readonly unknown[] }) => boolean }).predicate
    expect(predicate({ queryKey: ['transactions', 3, 'reimbursements', 90] })).toBe(true)
    expect(predicate({ queryKey: ['reports', 3] })).toBe(true)
    expect(predicate({ queryKey: ['budgets', 'x', 3] })).toBe(true)
    client.clear()
  })

  it('searches after typing rests, by the text', async () => {
    serve({ suggestions: (search) => (search ? [suggestion({ transactionKey: 77, merchantName: 'Airline', description: 'Flight', settlementAmount: -300, remainingAmount: 300, reason: 'search' })] : []) })
    const { view, client } = await renderScreen()
    expect(await view.findByText('No expense to suggest. Search by merchant or description.')).toBeOnTheScreen()
    await fireEvent.changeText(view.getByLabelText('Search expenses'), ' air ')
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, SUGGESTION_SEARCH_DELAY_MS + 20)) })
    expect(await view.findByRole('radio', { name: /^Airline/ })).toBeOnTheScreen()
    expect(view.getByRole('header', { name: 'Matching expenses' })).toBeOnTheScreen()
    expect(mockRead).toHaveBeenCalledWith(expect.objectContaining({ path: '/v1/account/transaction/90/reimbursements/suggestions?search=air&limit=10' }))
    client.clear()
  })

  it.each([
    ['reimbursement_currency_mismatch', 400, 'Only transactions in the same currency can be linked for now.'],
    ['reimbursement_amount_exceeded', 400, 'That is more than what is left of the expense or of this reimbursement.'],
    ['reimbursement_visibility_mismatch', 400, 'Both transactions must be on shared accounts, or on private accounts of the same person.'],
    ['reimbursement_invalid', 400, 'Only money in can reimburse money out, and neither can be a transfer or a loan repayment.'],
    ['reimbursement_link_exists', 409, 'These two are already linked. Unlink them first to change the amount.'],
    ['not_found', 404, 'That transaction or link is no longer available. Refresh and try again.'],
  ] as const)('words a refused link (%s) and stays open', async (serverCode, status, message) => {
    serve()
    mockWrite.mockRejectedValue(new ApiError('http', status, { serverCode }))
    const { view, onClose, client } = await renderScreen()
    await fireEvent.press(await view.findByRole('radio', { name: /^Corner shop/ }))
    await fireEvent.press(view.getByTestId('transaction-reimbursement-save'))
    expect(await view.findByText(message)).toBeOnTheScreen()
    expect(onClose).not.toHaveBeenCalled()
    client.clear()
  })

  it('shows existing links and unlinks one only after confirmation', async () => {
    serve({ links: { role: 'reimbursement', currencyCode: 'EUR', linkedAmount: 8, remainingAmount: 12, links: [existingLink] } })
    mockWrite.mockImplementation(async (_endpoint, options: { commit: (value: unknown) => void }) => {
      options.commit(undefined)
      return { transactionReimbursementKey: 5 }
    })
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined)
    const { view, client } = await renderScreen()
    expect(await view.findByText('Pharmacy')).toBeOnTheScreen()
    expect(view.getByRole('header', { name: 'Reimburses' })).toBeOnTheScreen()

    await fireEvent.press(view.getByRole('button', { name: 'Unlink Pharmacy' }))
    expect(mockWrite).not.toHaveBeenCalled()
    expect(alert).toHaveBeenCalledWith('Unlink this reimbursement?', '€8.00 linked with Pharmacy counts as spending and income again.', expect.any(Array))
    const buttons = alert.mock.calls[0]![2] as { text: string; onPress?: () => void }[]
    await act(async () => { buttons.find((button) => button.text === 'Unlink')?.onPress?.() })

    await waitFor(() => expect(mockWrite).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'DELETE', path: '/v1/account/transaction/90/reimbursements/5' }),
      expect.anything(),
    ))
    alert.mockRestore()
    client.clear()
  })

  it('says when the refund is fully linked instead of offering more expenses', async () => {
    serve({ links: { role: 'reimbursement', currencyCode: 'EUR', linkedAmount: 20, remainingAmount: 0, links: [{ ...existingLink, amount: 20 }] } })
    const { view, client } = await renderScreen()
    expect(await view.findByText('This reimbursement is fully linked. Unlink an expense to link another.')).toBeOnTheScreen()
    expect(view.queryByLabelText('Search expenses')).not.toBeOnTheScreen()
    client.clear()
  })

  it('speaks the screen in the app’s language', async () => {
    serve()
    const { view, client } = await renderScreen(jest.fn(), 'pt-PT')
    expect(view.getByRole('header', { name: 'Marcar como reembolso' })).toBeOnTheScreen()
    expect(view.getByText('Por agora só é possível associar despesas em EUR.')).toBeOnTheScreen()
    expect(await view.findByText('Mesmo comerciante')).toBeOnTheScreen()
    client.clear()
  })
})
