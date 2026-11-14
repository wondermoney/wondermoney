import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, waitFor } from '@testing-library/react-native'
import { Alert } from 'react-native'
import { I18nextProvider } from 'react-i18next'

import { transactionFixture } from '@/features/transactions/test-fixtures'
import { mapTransactions } from '@/features/transactions/transactions-view-model'
import { ApiError } from '@/lib/api/errors'
import { initMobileI18n } from '@/lib/i18n'

import type { ExpenseGroupDto, GroupExpenseDto } from './expense-groups-contract'
import { SplitWithGroupScreen } from './split-with-group-screen'
import { expenseFixture, groupFixture } from './test-fixtures'

const mockRead = jest.fn()
const mockWrite = jest.fn()

jest.mock('@/components/providers/product-runtime-provider', () => ({
  useProductRuntime: () => ({ runtime: { epochId: 3, apiClient: { read: mockRead, write: mockWrite } }, blockAccess: jest.fn() }),
}))

const dinner = mapTransactions({ transactions: [{
  ...transactionFixture,
  transactionKey: 41,
  transactionTypeKey: { name: 'debit' },
  transactionMerchantKey: { name: 'Tasca' },
  settlementAmount: 60,
  appuserSettlementAmount: 60,
}] })[0]!

const sharedLine = (key: number, memberKey: number, name: string, position: number) => ({
  transactionSplitKey: key,
  amount: -20,
  appuserAmount: -20,
  category: null,
  notes: null,
  position,
  expenseGroupMember: { expenseGroupKey: 4, expenseGroupMemberKey: memberKey, isHouseholdMember: memberKey !== 3, name },
})
const sharedDinner = mapTransactions({ transactions: [{
  ...transactionFixture,
  transactionKey: 41,
  transactionTypeKey: { name: 'debit' },
  settlementAmount: 60,
  appuserSettlementAmount: 60,
  splits: [sharedLine(5, 1, 'Ana', 0), sharedLine(6, 2, 'Rui', 1), sharedLine(7, 3, 'Sam', 2)],
}] })[0]!

function serve(groups: ExpenseGroupDto[] = [groupFixture, { ...groupFixture, expenseGroupKey: 9, name: 'Old flat', archived: true }], expense: GroupExpenseDto = expenseFixture()) {
  mockRead.mockImplementation(async (endpoint: { path: string }) => {
    if (endpoint.path === '/v1/expense-groups') return { groups }
    if (endpoint.path === '/v1/expense-groups/4/shares/41') return { expense }
    throw new Error(`Unexpected read ${endpoint.path}`)
  })
}

async function renderScreen(transaction = dinner, canWrite = true) {
  const i18n = await initMobileI18n('en')
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: 0 } } })
  const onClose = jest.fn()
  const view = await render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <SplitWithGroupScreen canWrite={canWrite} locale="en" onClose={onClose} transaction={transaction} />
      </I18nextProvider>
    </QueryClientProvider>,
  )
  return { view, onClose, client }
}

const writes = () => mockWrite.mock.calls.map(([endpoint, options]) => ({ method: endpoint.method, path: endpoint.path, body: options.body }))

beforeEach(() => {
  mockRead.mockReset()
  mockWrite.mockReset()
  mockWrite.mockImplementation(async (_endpoint, options: { commit: () => void }) => { options.commit(); return {} })
})

describe('Split with group', () => {
  it('starts with the only group still in use, everyone equally, paid by the reader, and saves it', async () => {
    serve()
    const { view, onClose, client } = await renderScreen()
    expect(view.getByRole('header', { name: 'Split with group' })).toBeOnTheScreen()
    // The archived group is not offered; the only other one is chosen already.
    expect(await view.findByRole('button', { name: 'Group, Lisbon trip' })).toBeOnTheScreen()
    expect(view.getByRole('button', { name: 'Paid by, Ana (you)' })).toBeOnTheScreen()
    expect(view.getByRole('tab', { name: 'Equally' })).toBeSelected()
    // €60 over three: €20 each, shown beside each person.
    expect(view.getAllByText(/€20\.00/)).toHaveLength(3)
    expect(view.getByText('Shares of people outside the household don\'t count as your spending.')).toBeOnTheScreen()

    await fireEvent.press(view.getByTestId('split-with-group-save'))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(writes()).toEqual([{
      method: 'POST',
      path: '/v1/expense-groups/4/shares',
      body: { transactionId: 41, paidByMemberId: 1, method: 'equal', shares: [{ memberId: 1 }, { memberId: 2 }, { memberId: 3 }] },
    }])
    client.clear()
  })

  it('checks amounts live: what is left, what is over, and saves only when they add up', async () => {
    serve()
    const { view, client } = await renderScreen()
    await fireEvent.press(await view.findByRole('tab', { name: 'By amount' }))
    // Leave Rui out.
    await fireEvent(view.getByRole('switch', { name: 'Include Rui' }), 'valueChange', false)
    await fireEvent.changeText(view.getByLabelText('Amount for Ana'), '25')
    await fireEvent.changeText(view.getByLabelText('Amount for Sam'), '20')
    expect(view.getByTestId('split-with-group-remaining')).toHaveTextContent('€15.00 left to assign')
    expect(view.getByTestId('split-with-group-save')).toBeDisabled()
    await fireEvent.changeText(view.getByLabelText('Amount for Sam'), '40')
    expect(view.getByTestId('split-with-group-remaining')).toHaveTextContent('€5.00 over the total')
    expect(view.getByTestId('split-with-group-save')).toBeDisabled()
    await fireEvent.changeText(view.getByLabelText('Amount for Sam'), '35')
    expect(view.getByTestId('split-with-group-remaining')).toHaveTextContent('Adds up')

    await fireEvent.press(view.getByTestId('split-with-group-save'))
    await waitFor(() => expect(mockWrite).toHaveBeenCalled())
    expect(writes()[0]?.body).toEqual({ transactionId: 41, paidByMemberId: 1, method: 'amounts', shares: [{ memberId: 1, amount: 25 }, { memberId: 3, amount: 35 }] })
    client.clear()
  })

  it('checks percentages: more than 0, two decimals at most, making 100', async () => {
    serve()
    const { view, client } = await renderScreen()
    await fireEvent.press(await view.findByRole('tab', { name: 'By percentage' }))
    await fireEvent.changeText(view.getByLabelText('Percentage for Ana'), '50')
    await fireEvent.changeText(view.getByLabelText('Percentage for Rui'), '25')
    await fireEvent.changeText(view.getByLabelText('Percentage for Sam'), '12.555')
    expect(view.getByText('Too many decimals.')).toBeOnTheScreen()
    await fireEvent.changeText(view.getByLabelText('Percentage for Sam'), '12.5')
    expect(view.getByTestId('split-with-group-remaining')).toHaveTextContent('12.5% left to assign')
    expect(view.getByTestId('split-with-group-save')).toBeDisabled()
    await fireEvent.changeText(view.getByLabelText('Percentage for Sam'), '25')
    await fireEvent.press(view.getByTestId('split-with-group-save'))
    await waitFor(() => expect(mockWrite).toHaveBeenCalled())
    expect(writes()[0]?.body).toMatchObject({ method: 'percentages', shares: [{ memberId: 1, percentage: 50 }, { memberId: 2, percentage: 25 }, { memberId: 3, percentage: 25 }] })
    client.clear()
  })

  it('words a refusal from the API', async () => {
    serve()
    mockWrite.mockRejectedValue(new ApiError('http', 409, { serverCode: 'expense_group_transaction_conflict' }))
    const { view, onClose, client } = await renderScreen()
    await view.findByRole('button', { name: 'Group, Lisbon trip' })
    await fireEvent.press(view.getByTestId('split-with-group-save'))
    expect(await view.findByRole('alert')).toHaveTextContent(/can't be shared: it is a transfer/)
    expect(onClose).not.toHaveBeenCalled()
    client.clear()
  })

  it('opens a shared transaction on its shares, edits them in their group, and stops sharing', async () => {
    serve(undefined, expenseFixture({ splitMethod: 'amounts', paidByMemberKey: 2 }))
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined)
    const { view, onClose, client } = await renderScreen(sharedDinner)
    expect(view.getByText('Current shares')).toBeOnTheScreen()
    expect(await view.findByText('Paid by Rui · Lisbon trip')).toBeOnTheScreen()
    // The label shows in the current shares and again in the form once the group has loaded,
    // so wait for the form first and accept more than one.
    expect(view.getAllByText('Not in the household').length).toBeGreaterThan(0)
    // The form starts from the saved shares, and the group cannot change.
    expect(view.getByRole('tab', { name: 'By amount' })).toBeSelected()
    expect(view.getByLabelText('Amount for Sam')).toHaveDisplayValue('20')
    expect(view.getByRole('button', { name: 'Paid by, Rui' })).toBeOnTheScreen()
    expect(view.getByRole('button', { name: 'Group, Lisbon trip' })).toBeDisabled()

    await fireEvent.press(view.getByRole('button', { name: 'Stop sharing' }))
    const buttons = alert.mock.calls[0]?.[2] ?? []
    await buttons.find((button) => button.style === 'destructive')?.onPress?.()
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(writes()).toEqual([{ method: 'DELETE', path: '/v1/expense-groups/4/shares/41', body: undefined }])
    alert.mockRestore()
    client.clear()
  })

  it('shows a viewer the shares and nothing to change', async () => {
    serve()
    const { view, client } = await renderScreen(sharedDinner, false)
    expect(view.getByText('Current shares')).toBeOnTheScreen()
    expect(view.queryByTestId('split-with-group-save')).not.toBeOnTheScreen()
    expect(view.queryByRole('button', { name: 'Stop sharing' })).not.toBeOnTheScreen()
    expect(view.queryByRole('tab', { name: 'Equally' })).not.toBeOnTheScreen()
    client.clear()
  })
})
