import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, waitFor } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { ApiError } from '@/lib/api/errors'
import { initMobileI18n } from '@/lib/i18n'

import { ExpenseGroupDetailScreen, type ExpenseGroupDetailState } from './expense-group-detail-screen'
import { groupFixture } from './test-fixtures'

const mockRead = jest.fn()
const mockWrite = jest.fn()

jest.mock('@/components/providers/product-runtime-provider', () => ({
  useProductRuntime: () => ({ runtime: { epochId: 3, apiClient: { read: mockRead, write: mockWrite } }, blockAccess: jest.fn() }),
}))

const loaded: ExpenseGroupDetailState = {
  status: 'loaded',
  group: groupFixture,
  balances: { expenseGroupKey: 4, currencies: [] },
  balancesFailed: false,
  expenses: [],
  expensesFailed: false,
  settlements: [],
  settlementsFailed: false,
  refreshing: false,
}

async function renderScreen(canWrite: boolean) {
  const i18n = await initMobileI18n('en')
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: 0 } } })
  const view = await render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <ExpenseGroupDetailScreen
          canWrite={canWrite}
          candidates={[]}
          currencies={['EUR', 'USD']}
          onBack={jest.fn()}
          onDeleted={jest.fn()}
          onRefresh={jest.fn()}
          state={loaded}
        />
      </I18nextProvider>
    </QueryClientProvider>,
  )
  return { view, client }
}

const written = () => mockWrite.mock.calls.map(([endpoint, options]) => ({ method: endpoint.method, path: endpoint.path, body: options.body }))

beforeEach(() => {
  mockRead.mockReset()
  mockWrite.mockReset()
  mockWrite.mockImplementation(async (_endpoint, options: { commit: () => void }) => { options.commit(); return { group: groupFixture } })
})

describe('Edit group', () => {
  it('renames the group and changes its currency, sending only what changed, then refreshes the group', async () => {
    const { view, client } = await renderScreen(true)
    const invalidate = jest.spyOn(client, 'invalidateQueries')

    await fireEvent.press(view.getByRole('button', { name: 'Edit group' }))
    expect(view.getByRole('header', { name: 'Edit group' })).toBeOnTheScreen()
    expect(view.getByLabelText('Name')).toHaveDisplayValue('Lisbon trip')
    // Changing it moves nothing already recorded.
    expect(view.getByText('New settlements default to it. Shared expenses and settlements already recorded keep their own currency, and balances stay per currency.')).toBeOnTheScreen()

    await fireEvent.changeText(view.getByLabelText('Name'), '  Porto trip ')
    await fireEvent.press(view.getByRole('button', { name: 'Currency, EUR' }))
    await fireEvent.press(view.getByRole('radio', { name: 'USD' }))
    await fireEvent.press(view.getByTestId('expense-group-edit-save'))

    await waitFor(() => expect(written()).toEqual([{ method: 'PATCH', path: '/v1/expense-groups/4', body: { name: 'Porto trip', currencyCode: 'USD' } }]))
    await waitFor(() => expect(view.queryByRole('header', { name: 'Edit group' })).toBeNull())
    expect(invalidate).toHaveBeenCalled()
  })

  it('sends a rename alone, and closes without a request when nothing changed', async () => {
    const { view } = await renderScreen(true)

    await fireEvent.press(view.getByRole('button', { name: 'Edit group' }))
    await fireEvent.press(view.getByTestId('expense-group-edit-save'))
    await waitFor(() => expect(view.queryByRole('header', { name: 'Edit group' })).toBeNull())
    expect(mockWrite).not.toHaveBeenCalled()

    await fireEvent.press(view.getByRole('button', { name: 'Edit group' }))
    await fireEvent.changeText(view.getByLabelText('Name'), 'Porto trip')
    await fireEvent.press(view.getByTestId('expense-group-edit-save'))
    await waitFor(() => expect(written()).toEqual([{ method: 'PATCH', path: '/v1/expense-groups/4', body: { name: 'Porto trip' } }]))
  })

  it('needs a name', async () => {
    const { view } = await renderScreen(true)

    await fireEvent.press(view.getByRole('button', { name: 'Edit group' }))
    await fireEvent.changeText(view.getByLabelText('Name'), '  ')
    await fireEvent.press(view.getByTestId('expense-group-edit-save'))

    expect(view.getByText('Give the group a name.')).toBeOnTheScreen()
    expect(mockWrite).not.toHaveBeenCalled()
  })

  it('keeps the sheet open with the refusal in words, and the draft', async () => {
    mockWrite.mockRejectedValue(new ApiError('http', 404, { serverCode: 'not_found' }))
    const { view } = await renderScreen(true)

    await fireEvent.press(view.getByRole('button', { name: 'Edit group' }))
    await fireEvent.changeText(view.getByLabelText('Name'), 'Porto trip')
    await fireEvent.press(view.getByTestId('expense-group-edit-save'))

    expect(await view.findByRole('alert')).toHaveTextContent('That group, person or transaction is no longer available. Refresh and try again.')
    expect(view.getByRole('header', { name: 'Edit group' })).toBeOnTheScreen()
    expect(view.getByLabelText('Name')).toHaveDisplayValue('Porto trip')
  })

  it('offers no edit to a household viewer', async () => {
    const { view } = await renderScreen(false)
    expect(view.getByRole('header', { name: 'Lisbon trip' })).toBeOnTheScreen()
    expect(view.queryByRole('button', { name: 'Edit group' })).toBeNull()
  })
})
