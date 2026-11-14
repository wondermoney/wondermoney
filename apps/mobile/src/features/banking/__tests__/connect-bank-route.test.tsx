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
const mockOpenAuthSessionAsync = jest.fn().mockResolvedValue({ type: 'dismiss' })
let mockInstitutionsState: {
  data?: unknown
  isAccessTransition: boolean
  isInitialFailure: boolean
  error: unknown
} = { data: [{ id: '1', name: 'Revolut', logo: 'https://logo' }], isAccessTransition: false, isInitialFailure: false, error: null }
let mockCredential: { status: string; sharedUnavailable?: boolean } = { status: 'ready' }
const mockInstitutionsOptions: unknown[] = []
let mockStartPending = false
let mockStartVariables: string | undefined

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace, back: mockBack, canGoBack: mockCanGoBack }),
}))
jest.mock('expo-web-browser', () => ({
  openAuthSessionAsync: (...args: unknown[]) => mockOpenAuthSessionAsync(...args),
}))
jest.mock('../use-bank-institutions', () => ({
  useBankInstitutions: (options: unknown) => {
    mockInstitutionsOptions.push(options)
    return { ...mockInstitutionsState, refetch: mockRefetch }
  },
}))
jest.mock('../use-bank-link-credential', () => ({ useBankLinkCredential: () => mockCredential }))
jest.mock('../use-start-bank-connection', () => ({
  useStartBankConnection: () => ({ isPending: mockStartPending, variables: mockStartVariables, mutate: mockMutate }),
  classifyStartBankConnectionFailure: (error: unknown) => (error as { code?: string } | null)?.code ?? 'general',
}))
jest.mock('../connect-bank-screen', () => ({
  ConnectBankScreen: (props: {
    state: { status: string; rows?: { id: string; name: string }[]; sharedUnavailable?: boolean }
    startFailure: string | null
    onBack: () => void
    onRetry: () => void
    onSelectBank: (row: { id: string; name: string; logo: string }) => void
  }) => {
    const Native = jest.requireActual<typeof import('react-native')>('react-native')
    return (
      <>
        <Native.Text testID="state">{props.state.status}</Native.Text>
        <Native.Text testID="sharedUnavailable">{String(props.state.sharedUnavailable ?? '')}</Native.Text>
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
    mockRefetch.mockClear(); mockMutate.mockReset(); mockOpenAuthSessionAsync.mockReset().mockResolvedValue({ type: 'dismiss' })
    mockInstitutionsState = { data: [{ id: '1', name: 'Revolut', logo: 'https://logo' }], isAccessTransition: false, isInitialFailure: false, error: null }
    mockStartPending = false; mockStartVariables = undefined
    mockCredential = { status: 'ready' }; mockInstitutionsOptions.length = 0
    captured.mockClear()
  })

  it('lists banks straight away when the person can link, with their own key or the server\'s shared one', async () => {
    const view = await render(<ConnectBankRoute />)

    expect(view.getByTestId('state').props.children).toBe('loaded')
    expect(mockInstitutionsOptions.at(-1)).toEqual({ enabled: true })
  })

  it('asks for a key, without asking for the bank list, when the person has none to use', async () => {
    mockCredential = { sharedUnavailable: false, status: 'credential-required' }
    const view = await render(<ConnectBankRoute />)

    expect(view.getByTestId('state').props.children).toBe('credential-required')
    expect(view.getByTestId('sharedUnavailable').props.children).toBe('false')
    expect(mockInstitutionsOptions.at(-1)).toEqual({ enabled: false })
  })

  it('passes on why the server\'s shared credential does not cover this household', async () => {
    mockCredential = { sharedUnavailable: true, status: 'credential-required' }
    const view = await render(<ConnectBankRoute />)

    expect(view.getByTestId('sharedUnavailable').props.children).toBe('true')
  })

  it('shows loading while it is still finding out', async () => {
    mockCredential = { status: 'loading' }
    const view = await render(<ConnectBankRoute />)

    expect(view.getByTestId('state').props.children).toBe('loading')
  })

  it('captures bank_connection_started with no institution and no consent redirect URL', async () => {
    mockMutate.mockImplementation((_bankId, { onSuccess }: { onSuccess: (value: { redirectUrl: string }) => void }) => {
      onSuccess({ redirectUrl: 'https://ob.enablebanking.com/session/abc' })
    })
    const view = await render(<ConnectBankRoute />)
    expect(captured).not.toHaveBeenCalled()

    await fireEvent.press(view.getByRole('button', { name: 'Select' }))

    expect(captured.mock.calls).toEqual([['bank_connection_started']])
    const serialized = JSON.stringify(captured.mock.calls)
    expect(serialized).not.toContain('Revolut')
    expect(serialized).not.toContain('enablebanking')
  })

  it('captures bank_connection_failed with no error text when the requisition never starts', async () => {
    mockMutate.mockImplementation((_bankId, { onError }: { onError: (error: unknown) => void }) => {
      onError(new ApiError('mfa-required', 401))
    })
    const view = await render(<ConnectBankRoute />)

    await fireEvent.press(view.getByRole('button', { name: 'Select' }))

    expect(captured.mock.calls).toEqual([['bank_connection_failed']])
  })

  it('opens the consent URL in an auth session that closes on the app return link', async () => {
    mockMutate.mockImplementation((bankId, { onSuccess }: { onSuccess: (value: { redirectUrl: string }) => void }) => {
      expect(bankId).toBe('1')
      onSuccess({ redirectUrl: 'https://ob.enablebanking.com/session/abc' })
    })
    const view = await render(<ConnectBankRoute />)
    await fireEvent.press(view.getByRole('button', { name: 'Select' }))
    expect(mockOpenAuthSessionAsync).toHaveBeenCalledWith('https://ob.enablebanking.com/session/abc', 'wondermoney://more/banking')
  })

  it.each(['dismiss', 'cancel'])('hands off to the polling connections list when the session ends with %s', async (type) => {
    mockOpenAuthSessionAsync.mockResolvedValue({ type })
    mockMutate.mockImplementation((_bankId, { onSuccess }: { onSuccess: (value: { redirectUrl: string }) => void }) => {
      onSuccess({ redirectUrl: 'https://ob.enablebanking.com/session/abc' })
    })
    const view = await render(<ConnectBankRoute />)
    await act(async () => { await fireEvent.press(view.getByRole('button', { name: 'Select' })) })
    expect(mockReplace).toHaveBeenCalledWith({ pathname: '/more/banking', params: { justStarted: '1' } })
  })

  it('carries the outcome when the session saw the return link', async () => {
    mockOpenAuthSessionAsync.mockResolvedValue({
      type: 'success',
      url: 'wondermoney://more/banking?enableBankingConnection=error',
    })
    mockMutate.mockImplementation((_bankId, { onSuccess }: { onSuccess: (value: { redirectUrl: string }) => void }) => {
      onSuccess({ redirectUrl: 'https://ob.enablebanking.com/session/abc' })
    })
    const view = await render(<ConnectBankRoute />)
    await act(async () => { await fireEvent.press(view.getByRole('button', { name: 'Select' })) })
    expect(mockReplace).toHaveBeenCalledWith({ pathname: '/more/banking', params: { justStarted: '1', connection: 'error' } })
  })

  it('falls back to the connections list when the session cannot open', async () => {
    mockOpenAuthSessionAsync.mockRejectedValue(new Error('no browser'))
    mockMutate.mockImplementation((_bankId, { onSuccess }: { onSuccess: (value: { redirectUrl: string }) => void }) => {
      onSuccess({ redirectUrl: 'https://ob.enablebanking.com/session/abc' })
    })
    const view = await render(<ConnectBankRoute />)
    await act(async () => { await fireEvent.press(view.getByRole('button', { name: 'Select' })) })
    expect(mockReplace).toHaveBeenCalledWith('/more/banking')
  })

  it('surfaces a classified error and opens no session when starting fails', async () => {
    mockMutate.mockImplementation((_bankId, { onError }: { onError: (error: unknown) => void }) => {
      onError(new ApiError('mfa-required', 401))
    })
    const view = await render(<ConnectBankRoute />)
    await fireEvent.press(view.getByRole('button', { name: 'Select' }))
    expect(view.getByTestId('startFailure')).toHaveTextContent('mfa-required')
    expect(mockOpenAuthSessionAsync).not.toHaveBeenCalled()
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
