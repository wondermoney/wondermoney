import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, waitFor } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { formatIsoDate } from '@/components/ui/date-field'
import { ApiError } from '@/lib/api/errors'
import { initMobileI18n } from '@/lib/i18n'

import { RecordSettlementScreen, type SettlementPrefill } from './record-settlement-screen'
import { groupFixture, suggestionFixture } from './test-fixtures'

const mockRead = jest.fn()
const mockWrite = jest.fn()

jest.mock('@/components/providers/product-runtime-provider', () => ({
  useProductRuntime: () => ({ runtime: { epochId: 3, apiClient: { read: mockRead, write: mockWrite } }, blockAccess: jest.fn() }),
}))

function serve() {
  mockRead.mockImplementation(async (endpoint: { path: string }) => {
    if (endpoint.path.startsWith('/v1/expense-groups/4/settlements/suggestions?')) {
      return { suggestions: [suggestionFixture(), suggestionFixture({ transactionKey: 78, description: 'Cash deposit', settlementAmount: 15, remainingAmount: 15 })] }
    }
    throw new Error(`Unexpected read ${endpoint.path}`)
  })
}

async function renderScreen(prefill: SettlementPrefill | null = null) {
  const i18n = await initMobileI18n('en')
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: 0 } } })
  const onClose = jest.fn()
  const view = await render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <RecordSettlementScreen group={groupFixture} locale="en" onClose={onClose} prefill={prefill} />
      </I18nextProvider>
    </QueryClientProvider>,
  )
  return { view, onClose, client }
}

const posted = () => mockWrite.mock.calls.map(([endpoint, options]) => ({ path: endpoint.path, body: options.body }))

beforeEach(() => {
  mockRead.mockReset()
  mockWrite.mockReset()
  mockWrite.mockImplementation(async (_endpoint, options: { commit: () => void }) => { options.commit(); return {} })
})

describe('Record settlement', () => {
  it('starts from a suggested payment and links the transaction that brought the money in', async () => {
    serve()
    const { view, onClose, client } = await renderScreen({ fromMemberKey: 3, toMemberKey: 1, amount: 20, currencyCode: 'EUR' })
    expect(view.getByRole('header', { name: 'Record settlement' })).toBeOnTheScreen()
    expect(view.getByRole('button', { name: 'From, Sam' })).toBeOnTheScreen()
    expect(view.getByRole('button', { name: 'To, Ana (you)' })).toBeOnTheScreen()
    expect(view.getByLabelText('Amount in EUR')).toHaveDisplayValue('20')
    expect(view.getByText('In EUR.')).toBeOnTheScreen()

    // Sam is outside the household and Ana in it: the money can be linked.
    expect(view.getByText('Linked transaction')).toBeOnTheScreen()
    const suggestion = await view.findByRole('radio', { name: /^Transfer from Sam, €20\.00/ })
    expect(mockRead).toHaveBeenCalledWith(expect.objectContaining({ path: '/v1/expense-groups/4/settlements/suggestions?fromMemberId=3&toMemberId=1&currencyCode=EUR&limit=10' }))
    await fireEvent.press(suggestion)
    expect(view.getByRole('radio', { name: /^Transfer from Sam/ })).toBeChecked()
    await fireEvent.changeText(view.getByLabelText('Notes'), ' Bank transfer ')

    await fireEvent.press(view.getByTestId('record-settlement-save'))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(posted()).toEqual([{
      path: '/v1/expense-groups/4/settlements',
      body: { fromMemberId: 3, toMemberId: 1, amount: 20, settledOn: formatIsoDate(new Date()), currencyCode: 'EUR', notes: 'Bank transfer', transactionId: 77 },
    }])
    client.clear()
  })

  it('caps the amount at what is left on the linked transaction', async () => {
    serve()
    const { view, client } = await renderScreen({ fromMemberKey: 3, toMemberKey: 1, amount: 20, currencyCode: 'EUR' })
    await fireEvent.press(await view.findByRole('radio', { name: /^Cash deposit/ }))
    // Choosing it brings the amount down to the 15 still unlinked.
    expect(view.getByLabelText('Amount in EUR')).toHaveDisplayValue('15')
    await fireEvent.changeText(view.getByLabelText('Amount in EUR'), '18')
    expect(view.getByText('At most €15.00 is left on the linked transaction.')).toBeOnTheScreen()
    expect(view.getByTestId('record-settlement-save')).toBeDisabled()
    client.clear()
  })

  it('offers no transaction between two people of the household, and refuses paying oneself', async () => {
    serve()
    const { view, client } = await renderScreen({ fromMemberKey: 2, toMemberKey: 1, amount: 10, currencyCode: 'EUR' })
    expect(view.queryByText('Linked transaction')).not.toBeOnTheScreen()
    expect(mockRead).not.toHaveBeenCalled()
    await fireEvent.press(view.getByRole('button', { name: 'To, Ana (you)' }))
    await fireEvent.press(view.getByRole('radio', { name: 'Rui' }))
    expect(view.getByText('Choose two different people.')).toBeOnTheScreen()
    expect(view.getByTestId('record-settlement-save')).toBeDisabled()
    client.clear()
  })

  it('records one from scratch and words a refusal', async () => {
    serve()
    mockWrite.mockRejectedValue(new ApiError('http', 400, { serverCode: 'expense_group_amount_exceeded' }))
    const { view, onClose, client } = await renderScreen()
    expect(view.getByTestId('record-settlement-save')).toBeDisabled()
    await fireEvent.press(view.getByRole('button', { name: 'From, Choose' }))
    await fireEvent.press(view.getByRole('radio', { name: 'Rui' }))
    await fireEvent.press(view.getByRole('button', { name: 'To, Choose' }))
    await fireEvent.press(view.getByRole('radio', { name: 'Ana (you)' }))
    await fireEvent.changeText(view.getByLabelText('Amount in EUR'), '12.5')
    await fireEvent.press(view.getByTestId('record-settlement-save'))
    expect(await view.findByRole('alert')).toHaveTextContent('That is more than what is left on the linked transaction.')
    expect(posted()[0]?.body).toMatchObject({ fromMemberId: 2, toMemberId: 1, amount: 12.5, transactionId: null, notes: null })
    expect(onClose).not.toHaveBeenCalled()
    client.clear()
  })
})
