import { fireEvent, render } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { initMobileI18n } from '@/lib/i18n'

import { OnboardingCreateAccountRoute } from '../onboarding-create-account-route'

async function renderRoute() {
  const i18n = await initMobileI18n('en')
  return render(
    <I18nextProvider i18n={i18n}>
      <OnboardingCreateAccountRoute />
    </I18nextProvider>,
  )
}

const mockReplace = jest.fn()
const mockAddListener = jest.fn().mockReturnValue(jest.fn())
const mockCreateMutate = jest.fn()
const mockReconcile = jest.fn()
const mockClear = jest.fn()
const mockCompletionMutate = jest.fn()
let mockCreatePending = false
let mockCompletionPending = false
let mockSearchParams: { version?: string } = { version: '3' }

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockSearchParams,
  useRouter: () => ({ replace: mockReplace }),
  useNavigation: () => ({ addListener: mockAddListener }),
}))
jest.mock('@/features/accounts/use-offline-account-options', () => ({ useOfflineAccountOptions: () => ({
  currencies: { data: { currencies: [{ currencyKey: 151, code: 'EUR', description: 'Euro' }] } },
  institutions: { data: { accountFinancialInstitutions: [] } },
  isAccessTransition: false,
  isLoading: false,
  error: null,
  refetch: jest.fn(),
}) }))
jest.mock('@/features/accounts/use-create-offline-account', () => ({
  useCreateOfflineAccount: () => ({ isPending: mockCreatePending, unknownGuard: null, mutateAsync: mockCreateMutate, reconcile: mockReconcile, clearUnknownGuard: mockClear }),
  classifyOfflineAccountCreateFailure: () => 'general',
}))
jest.mock('../use-complete-onboarding', () => ({
  useCompleteOnboarding: () => ({ isPending: mockCompletionPending, mutateAsync: mockCompletionMutate }),
}))
jest.mock('@/features/accounts/offline-account-create-screen', () => ({ OfflineAccountCreateScreen: (props: { onConfirm: (payload: unknown) => Promise<unknown>; onCheckAccounts: () => Promise<void> }) => {
  const Native = jest.requireActual<typeof import('react-native')>('react-native')
  return <><Native.Pressable accessibilityRole="button" accessibilityLabel="Confirm" onPress={() => void props.onConfirm({ name: 'Cash', currentBalance: 1, currencyId: 151 })}><Native.Text>Confirm</Native.Text></Native.Pressable><Native.Pressable accessibilityRole="button" accessibilityLabel="Check" onPress={() => void props.onCheckAccounts()}><Native.Text>Check</Native.Text></Native.Pressable></>
} }))

describe('onboarding create-account route', () => {
  beforeEach(() => {
    mockReplace.mockReset(); mockAddListener.mockClear(); mockCreateMutate.mockReset(); mockReconcile.mockReset(); mockClear.mockReset(); mockCompletionMutate.mockReset()
    mockCreatePending = false; mockCompletionPending = false; mockSearchParams = { version: '3' }
  })

  it('creates the account, completes onboarding with the version from params, and returns to the authenticated shell', async () => {
    mockCreateMutate.mockResolvedValue(undefined)
    mockCompletionMutate.mockResolvedValue(undefined)
    const view = await renderRoute()
    await fireEvent.press(view.getByRole('button', { name: 'Confirm' }))
    expect(mockCreateMutate).toHaveBeenCalledTimes(1)
    expect(mockCompletionMutate).toHaveBeenCalledWith({ version: 3 })
    expect(mockReplace).toHaveBeenCalledWith('/')
  })

  it('still returns to the authenticated shell if completing onboarding fails after the account was created', async () => {
    mockCreateMutate.mockResolvedValue(undefined)
    mockCompletionMutate.mockRejectedValue(new Error('stale version'))
    const view = await renderRoute()
    await fireEvent.press(view.getByRole('button', { name: 'Confirm' }))
    expect(mockReplace).toHaveBeenCalledWith('/')
  })

  it('does not complete onboarding or navigate away when account creation itself fails', async () => {
    mockCreateMutate.mockRejectedValue(new Error('validation'))
    const view = await renderRoute()
    await fireEvent.press(view.getByRole('button', { name: 'Confirm' }))
    expect(mockCompletionMutate).not.toHaveBeenCalled()
    expect(mockReplace).not.toHaveBeenCalled()
  })

  it('checks authoritative account families and returns to the authenticated shell', async () => {
    mockReconcile.mockResolvedValue(undefined)
    const view = await renderRoute()
    await fireEvent.press(view.getByRole('button', { name: 'Check' }))
    expect(mockReconcile).toHaveBeenCalledTimes(1)
    expect(mockReplace).toHaveBeenCalledWith('/')
  })

  it('registers a pending navigation removal lock while either mutation is in flight', async () => {
    mockCreatePending = true
    await renderRoute()
    const listener = mockAddListener.mock.calls[0][1]
    const event = { preventDefault: jest.fn() }
    listener(event)
    expect(event.preventDefault).toHaveBeenCalledTimes(1)
  })

  it('falls back to an invalid-version state and returns to onboarding when the version param is missing', async () => {
    mockSearchParams = {}
    const view = await renderRoute()
    expect(view.queryByRole('button', { name: 'Confirm' })).toBeNull()
    fireEvent.press(view.getByLabelText('Back to onboarding'))
    expect(mockReplace).toHaveBeenCalledWith('/onboarding')
  })

  it('falls back to an invalid-version state when the version param is not a valid integer', async () => {
    mockSearchParams = { version: 'not-a-number' }
    const view = await renderRoute()
    expect(view.queryByRole('button', { name: 'Confirm' })).toBeNull()
    expect(view.getByLabelText('Back to onboarding')).toBeTruthy()
  })
})
