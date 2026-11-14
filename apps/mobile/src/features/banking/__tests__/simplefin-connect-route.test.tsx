import { act, fireEvent, render } from '@testing-library/react-native'

import { ApiError } from '@/lib/api/errors'
import { captureAnalyticsEvent } from '@/lib/telemetry/analytics'

import { SimplefinConnectRoute } from '../simplefin-connect-route'

jest.mock('@/lib/telemetry/analytics', () => ({ captureAnalyticsEvent: jest.fn() }))
const captured = jest.mocked(captureAnalyticsEvent)

const mockReplace = jest.fn()
const mockBack = jest.fn()
const mockCanGoBack = jest.fn().mockReturnValue(true)
const mockMutate = jest.fn()
const mockReset = jest.fn()
const mockOpenURL = jest.fn().mockResolvedValue(true)

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace, back: mockBack, canGoBack: mockCanGoBack }),
}))
jest.mock('expo-linking', () => ({ openURL: (...args: unknown[]) => mockOpenURL(...args) }))
jest.mock('../use-connect-simplefin', () => ({
  useConnectSimplefin: () => ({ isPending: false, mutate: mockMutate, reset: mockReset }),
  classifySimplefinConnectFailure: jest.requireActual('../use-connect-simplefin').classifySimplefinConnectFailure,
}))
jest.mock('../simplefin-connect-screen', () => ({
  SimplefinConnectScreen: (props: {
    failure: { reason: string; serverMessage: string | null } | null
    onBack: () => void
    onSubmit: (token: string) => void
    onOpenBridge: () => void
  }) => {
    const Native = jest.requireActual<typeof import('react-native')>('react-native')
    return (
      <>
        <Native.Text testID="failure">{props.failure ? `${props.failure.reason}:${props.failure.serverMessage ?? ''}` : 'none'}</Native.Text>
        <Native.Pressable accessibilityRole="button" accessibilityLabel="Submit" onPress={() => props.onSubmit('secret-setup-token')}><Native.Text>Submit</Native.Text></Native.Pressable>
        <Native.Pressable accessibilityRole="button" accessibilityLabel="Bridge" onPress={props.onOpenBridge}><Native.Text>Bridge</Native.Text></Native.Pressable>
        <Native.Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={props.onBack}><Native.Text>Back</Native.Text></Native.Pressable>
      </>
    )
  },
}))

type MutateOptions = { onSuccess: (value: unknown) => void; onError: (error: unknown) => void; onSettled: () => void }

describe('SimplefinConnectRoute', () => {
  beforeEach(() => {
    mockReplace.mockClear(); mockBack.mockClear(); mockCanGoBack.mockReset().mockReturnValue(true)
    mockMutate.mockReset(); mockReset.mockClear(); mockOpenURL.mockClear(); captured.mockClear()
  })

  it('returns to the connections list with the success notice once connected, and forgets the token', async () => {
    mockMutate.mockImplementation((token: string, options: MutateOptions) => {
      expect(token).toBe('secret-setup-token')
      options.onSuccess({ connectionId: 3, incidentId: null })
      options.onSettled()
    })
    const view = await render(<SimplefinConnectRoute />)
    await fireEvent.press(view.getByRole('button', { name: 'Submit' }))
    expect(mockReplace).toHaveBeenCalledWith({ pathname: '/more/banking', params: { justStarted: '1', connection: 'success' } })
    expect(mockReset).toHaveBeenCalledTimes(1)
    expect(captured.mock.calls).toEqual([['bank_connection_started']])
    expect(JSON.stringify(captured.mock.calls)).not.toContain('secret-setup-token')
  })

  it("stays on the screen with the API's message when the token is refused", async () => {
    mockMutate.mockImplementation((_token: string, options: MutateOptions) => {
      options.onError(new ApiError('http', 400, { serverMessage: 'SimpleFIN did not accept this setup token.' }))
      options.onSettled()
    })
    const view = await render(<SimplefinConnectRoute />)
    await act(async () => { await fireEvent.press(view.getByRole('button', { name: 'Submit' })) })
    expect(view.getByTestId('failure')).toHaveTextContent('rejected:SimpleFIN did not accept this setup token.')
    expect(mockReplace).not.toHaveBeenCalled()
    expect(captured.mock.calls).toEqual([['bank_connection_failed']])
  })

  it('reads an already-claimed token by its code', async () => {
    mockMutate.mockImplementation((_token: string, options: MutateOptions) => {
      options.onError(new ApiError('http', 400, { serverCode: 'simplefin_token_already_claimed', serverMessage: 'English text' }))
    })
    const view = await render(<SimplefinConnectRoute />)
    await act(async () => { await fireEvent.press(view.getByRole('button', { name: 'Submit' })) })
    expect(view.getByTestId('failure')).toHaveTextContent('token-already-claimed:')
  })

  it('reads a server without SimpleFIN as disabled', async () => {
    mockMutate.mockImplementation((_token: string, options: MutateOptions) => {
      options.onError(new ApiError('http', 501))
    })
    const view = await render(<SimplefinConnectRoute />)
    await act(async () => { await fireEvent.press(view.getByRole('button', { name: 'Submit' })) })
    expect(view.getByTestId('failure')).toHaveTextContent('disabled:')
  })

  it('opens SimpleFIN Bridge', async () => {
    const view = await render(<SimplefinConnectRoute />)
    await fireEvent.press(view.getByRole('button', { name: 'Bridge' }))
    expect(mockOpenURL).toHaveBeenCalledWith('https://bridge.simplefin.org/')
  })

  it('goes back when possible, otherwise to the connections list', async () => {
    const view = await render(<SimplefinConnectRoute />)
    await fireEvent.press(view.getByRole('button', { name: 'Back' }))
    expect(mockBack).toHaveBeenCalledTimes(1)
    mockCanGoBack.mockReturnValue(false)
    await fireEvent.press(view.getByRole('button', { name: 'Back' }))
    expect(mockReplace).toHaveBeenCalledWith('/more/banking')
  })
})
