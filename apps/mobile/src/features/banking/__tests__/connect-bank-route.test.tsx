import { act, fireEvent, render } from '@testing-library/react-native'

import { ApiError } from '@/lib/api/errors'
import { captureAnalyticsEvent } from '@/lib/telemetry/analytics'

import { ConnectBankRoute } from '../connect-bank-route'

jest.mock('@/lib/telemetry/analytics', () => ({ captureAnalyticsEvent: jest.fn() }))
const captured = jest.mocked(captureAnalyticsEvent)

const mockReplace = jest.fn()
const mockBack = jest.fn()
const mockCanGoBack = jest.fn().mockReturnValue(true)
const mockRefetch = jest.fn()
const mockMutate = jest.fn()
const mockOpenBrowserAsync = jest.fn().mockResolvedValue({ type: 'dismiss' })
let mockReturnCallback: (() => void) | undefined
let mockArmed = false
let mockInstitutionsState: {
  data?: unknown
  isAccessTransition: boolean
  isInitialFailure: boolean
  error: unknown
} = { data: [{ id: '1', name: 'Revolut', logo: 'https://logo' }], isAccessTransition: false, isInitialFailure: false, error: null }
let mockStartPending = false
let mockStartVariables: string | undefined

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace, back: mockBack, canGoBack: mockCanGoBack }),
}))
jest.mock('expo-web-browser', () => ({
  openBrowserAsync: (...args: unknown[]) => mockOpenBrowserAsync(...args),
  WebBrowserPresentationStyle: { AUTOMATIC: 'automatic' },
}))
jest.mock('../use-bank-institutions', () => ({ useBankInstitutions: () => ({ ...mockInstitutionsState, refetch: mockRefetch }) }))
jest.mock('../use-start-bank-connection', () => ({
  useStartBankConnection: () => ({ isPending: mockStartPending, variables: mockStartVariables, mutate: mockMutate }),
  classifyStartBankConnectionFailure: (error: unknown) => (error as { code?: string } | null)?.code ?? 'general',
}))
jest.mock('../use-return-from-browser', () => ({
  useReturnFromBrowser: (armed: boolean, onReturn: () => void) => {
    mockArmed = armed
    mockReturnCallback = onReturn
  },
}))
jest.mock('../connect-bank-screen', () => ({
  ConnectBankScreen: (props: {
    state: { status: string; rows?: { id: string; name: string }[] }
    startFailure: string | null
    onBack: () => void
    onRetry: () => void
    onSelectBank: (row: { id: string; name: string; logo: string }) => void
  }) => {
    const Native = jest.requireActual<typeof import('react-native')>('react-native')
    return (
      <>
        <Native.Text testID="state">{props.state.status}</Native.Text>
        <Native.Text testID="startFailure">{props.startFailure ?? ''}</Native.Text>
        <Native.Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={props.onBack}><Native.Text>Back</Native.Text></Native.Pressable>
        <Native.Pressable accessibilityRole="button" accessibilityLabel="Retry" onPress={props.onRetry}><Native.Text>Retry</Native.Text></Native.Pressable>
        <Native.Pressable accessibilityRole="button" accessibilityLabel="Select" onPress={() => props.onSelectBank({ id: '1', name: 'Revolut', logo: 'https://logo' })}><Native.Text>Select</Native.Text></Native.Pressable>
      </>
    )
  },
}))

describe('ConnectBankRoute', () => {
  beforeEach(() => {
    mockReplace.mockClear(); mockBack.mockClear(); mockCanGoBack.mockReset().mockReturnValue(true)
    mockRefetch.mockClear(); mockMutate.mockReset(); mockOpenBrowserAsync.mockClear()
    mockReturnCallback = undefined; mockArmed = false
    mockInstitutionsState = { data: [{ id: '1', name: 'Revolut', logo: 'https://logo' }], isAccessTransition: false, isInitialFailure: false, error: null }
    mockStartPending = false; mockStartVariables = undefined
    captured.mockClear()
  })

  it('captures bank_connection_started with no institution and no consent redirect URL (RAD-518)', async () => {
    mockMutate.mockImplementation((_bankId, { onSuccess }: { onSuccess: (value: { redirectUrl: string }) => void }) => {
      onSuccess({ redirectUrl: 'https://ob.gocardless.com/session/abc' })
    })
    const view = await render(<ConnectBankRoute />)
    expect(captured).not.toHaveBeenCalled()

    await fireEvent.press(view.getByRole('button', { name: 'Select' }))

    expect(captured.mock.calls).toEqual([['bank_connection_started']])
    const serialized = JSON.stringify(captured.mock.calls)
    expect(serialized).not.toContain('Revolut')
    expect(serialized).not.toContain('gocardless')
  })

  it('captures bank_connection_failed with no error text when the requisition never starts', async () => {
    mockMutate.mockImplementation((_bankId, { onError }: { onError: (error: unknown) => void }) => {
      onError(new ApiError('mfa-required', 401))
    })
    const view = await render(<ConnectBankRoute />)

    await fireEvent.press(view.getByRole('button', { name: 'Select' }))

    expect(captured.mock.calls).toEqual([['bank_connection_failed']])
  })

  it('starts a connection and opens the returned redirect URL in the in-app browser', async () => {
    mockMutate.mockImplementation((bankId, { onSuccess }: { onSuccess: (value: { redirectUrl: string }) => void }) => {
      expect(bankId).toBe('1')
      onSuccess({ redirectUrl: 'https://ob.gocardless.com/session/abc' })
    })
    const view = await render(<ConnectBankRoute />)
    await fireEvent.press(view.getByRole('button', { name: 'Select' }))
    expect(mockOpenBrowserAsync).toHaveBeenCalledWith('https://ob.gocardless.com/session/abc', expect.objectContaining({ presentationStyle: 'automatic' }))
  })

  it('arms return detection once the browser opens and navigates to connections with a justStarted marker on return', async () => {
    mockMutate.mockImplementation((_bankId, { onSuccess }: { onSuccess: (value: { redirectUrl: string }) => void }) => {
      onSuccess({ redirectUrl: 'https://ob.gocardless.com/session/abc' })
    })
    const view = await render(<ConnectBankRoute />)
    await fireEvent.press(view.getByRole('button', { name: 'Select' }))
    expect(mockArmed).toBe(true)
    await act(async () => { mockReturnCallback?.() })
    expect(mockReplace).toHaveBeenCalledWith(expect.objectContaining({ pathname: '/more/banking', params: { justStarted: '1' } }))
  })

  it('surfaces a classified error and never arms return detection when starting fails', async () => {
    mockMutate.mockImplementation((_bankId, { onError }: { onError: (error: unknown) => void }) => {
      onError(new ApiError('mfa-required', 401))
    })
    const view = await render(<ConnectBankRoute />)
    await fireEvent.press(view.getByRole('button', { name: 'Select' }))
    expect(view.getByTestId('startFailure')).toHaveTextContent('mfa-required')
    expect(mockArmed).toBe(false)
  })

  it('retries the institutions query', async () => {
    const view = await render(<ConnectBankRoute />)
    await fireEvent.press(view.getByRole('button', { name: 'Retry' }))
    expect(mockRefetch).toHaveBeenCalledTimes(1)
  })

  it('goes back when possible, otherwise replaces with the connections list', async () => {
    const view = await render(<ConnectBankRoute />)
    await fireEvent.press(view.getByRole('button', { name: 'Back' }))
    expect(mockBack).toHaveBeenCalledTimes(1)

    mockCanGoBack.mockReturnValue(false)
    const other = await render(<ConnectBankRoute />)
    await fireEvent.press(other.getByRole('button', { name: 'Back' }))
    expect(mockReplace).toHaveBeenCalledWith('/more/banking')
  })
})
