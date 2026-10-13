import { fireEvent, render } from '@testing-library/react-native'

import { OfflineAccountCreateRoute } from './offline-account-create-route'

const mockReplace = jest.fn()
const mockAddListener = jest.fn().mockReturnValue(jest.fn())
const mockMutate = jest.fn()
const mockReconcile = jest.fn()
const mockClear = jest.fn()
let mockPending = false

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace }),
  useNavigation: () => ({ addListener: mockAddListener }),
}))
jest.mock('./use-offline-account-options', () => ({ useOfflineAccountOptions: () => ({
  currencies: { data: { currencies: [{ currencyKey: 151, code: 'EUR', description: 'Euro' }] } },
  institutions: { data: { accountFinancialInstitutions: [] } },
  isAccessTransition: false,
  isLoading: false,
  error: null,
  refetch: jest.fn(),
}) }))
jest.mock('./use-create-offline-account', () => ({
  useCreateOfflineAccount: () => ({ isPending: mockPending, unknownGuard: null, mutateAsync: mockMutate, reconcile: mockReconcile, clearUnknownGuard: mockClear }),
  classifyOfflineAccountCreateFailure: () => 'general',
}))
jest.mock('./offline-account-create-screen', () => ({ OfflineAccountCreateScreen: (props: { onConfirm: (payload: unknown) => Promise<unknown>; onCheckAccounts: () => Promise<void> }) => {
  const Native = jest.requireActual<typeof import('react-native')>('react-native')
  return <><Native.Pressable accessibilityRole="button" accessibilityLabel="Confirm" onPress={() => void props.onConfirm({ name: 'Cash', currentBalance: 1, currencyId: 151 })}><Native.Text>Confirm</Native.Text></Native.Pressable><Native.Pressable accessibilityRole="button" accessibilityLabel="Check" onPress={() => void props.onCheckAccounts()}><Native.Text>Check</Native.Text></Native.Pressable></>
} }))

describe('manual account creation route', () => {
  beforeEach(() => {
    mockReplace.mockReset(); mockAddListener.mockClear(); mockMutate.mockReset(); mockReconcile.mockReset(); mockClear.mockReset(); mockPending = false
  })

  it('awaits successful creation and returns to Accounts without inferring a created id', async () => {
    mockMutate.mockResolvedValue(undefined)
    const view = await render(<OfflineAccountCreateRoute />)
    await fireEvent.press(view.getByRole('button', { name: 'Confirm' }))
    expect(mockMutate).toHaveBeenCalledTimes(1)
    expect(mockReplace).toHaveBeenCalledWith('/accounts')
    expect(mockReplace).not.toHaveBeenCalledWith(expect.objectContaining({ pathname: expect.stringContaining('[accountId]') }))
  })

  it('checks authoritative account families and then returns to Accounts', async () => {
    mockReconcile.mockResolvedValue(undefined)
    const view = await render(<OfflineAccountCreateRoute />)
    await fireEvent.press(view.getByRole('button', { name: 'Check' }))
    expect(mockReconcile).toHaveBeenCalledTimes(1)
    expect(mockReplace).toHaveBeenCalledWith('/accounts')
  })

  it('registers a pending navigation removal lock', async () => {
    mockPending = true
    await render(<OfflineAccountCreateRoute />)
    const listener = mockAddListener.mock.calls[0][1]
    const event = { preventDefault: jest.fn() }
    listener(event)
    expect(event.preventDefault).toHaveBeenCalledTimes(1)
  })
})
