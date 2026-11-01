import { fireEvent, render } from '@testing-library/react-native'

import { ApiError } from '@/lib/api/errors'
import { captureAnalyticsEvent } from '@/lib/telemetry/analytics'

import type { BankConnectionDto } from '../connection-status-contract'
import { ConnectionsRoute } from '../connections-route'

jest.mock('@/lib/telemetry/analytics', () => ({ captureAnalyticsEvent: jest.fn() }))
const captured = jest.mocked(captureAnalyticsEvent)

let mockConnections: BankConnectionDto[] = []
const connection = (status: BankConnectionDto['status']): BankConnectionDto => ({
  accessType: 'open_banking',
  connectionId: 42,
  dataFreshAsOf: null,
  expiresAt: null,
  institutionName: 'Revolut',
  provider: 'GoCardless',
  status,
})

const mockReplace = jest.fn()
const mockPush = jest.fn()
const mockBack = jest.fn()
const mockCanGoBack = jest.fn().mockReturnValue(true)
const mockRefetch = jest.fn()
const mockMutateAsync = jest.fn()
let mockParams: { justStarted?: string; connection?: string } = {}
let mockIsPending = false
let mockVariables: number | undefined

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace, push: mockPush, back: mockBack, canGoBack: mockCanGoBack }),
  useLocalSearchParams: () => mockParams,
}))
jest.mock('../use-bank-connections', () => ({
  useBankConnections: () => ({
    data: { connections: mockConnections },
    isAccessTransition: false,
    isInitialFailure: false,
    isNotFound: false,
    error: null,
    refetch: mockRefetch,
    isRefreshing: false,
  }),
}))
jest.mock('../use-bank-connection-disconnect-mutation', () => ({
  useBankConnectionDisconnectMutation: () => ({
    mutateAsync: mockMutateAsync,
    isPending: mockIsPending,
    variables: mockVariables,
  }),
  classifyBankConnectionDisconnectFailure: jest.requireActual('../use-bank-connection-disconnect-mutation').classifyBankConnectionDisconnectFailure,
}))
jest.mock('../connections-screen', () => ({
  ConnectionsScreen: (props: {
    justStarted: boolean
    connectionResult: string | null
    onConnectBank: () => void
    onBack: () => void
    onRefresh: () => void
    onDisconnect: (connectionId: number) => Promise<void>
    disconnectingConnectionId: number | null
    disconnectFailure: { connectionId: number; failure: string } | null
    onImportStatement: () => void
  }) => {
    const Native = jest.requireActual<typeof import('react-native')>('react-native')
    return (
      <>
        <Native.Text testID="justStarted">{String(props.justStarted)}</Native.Text>
        <Native.Text testID="connectionResult">{String(props.connectionResult)}</Native.Text>
        <Native.Text testID="disconnecting">{String(props.disconnectingConnectionId)}</Native.Text>
        <Native.Text testID="disconnectFailure">{props.disconnectFailure ? `${props.disconnectFailure.connectionId}:${props.disconnectFailure.failure}` : 'none'}</Native.Text>
        <Native.Pressable accessibilityRole="button" accessibilityLabel="ConnectBank" onPress={props.onConnectBank}><Native.Text>Connect</Native.Text></Native.Pressable>
        <Native.Pressable accessibilityRole="button" accessibilityLabel="Refresh" onPress={props.onRefresh}><Native.Text>Refresh</Native.Text></Native.Pressable>
        <Native.Pressable accessibilityRole="button" accessibilityLabel="Disconnect" onPress={() => void props.onDisconnect(42)}><Native.Text>Disconnect</Native.Text></Native.Pressable>
        <Native.Pressable accessibilityRole="button" accessibilityLabel="ImportStatement" onPress={props.onImportStatement}><Native.Text>Import statement</Native.Text></Native.Pressable>
      </>
    )
  },
}))

describe('ConnectionsRoute', () => {
  beforeEach(() => {
    mockReplace.mockClear(); mockPush.mockClear(); mockBack.mockClear(); mockCanGoBack.mockReset().mockReturnValue(true)
    mockRefetch.mockClear(); mockParams = {}
    mockMutateAsync.mockReset(); mockIsPending = false; mockVariables = undefined
    mockConnections = []; captured.mockClear()
  })

  describe('bank connection outcomes', () => {
    it('captures nothing for a list that already contains settled connections when the screen opens', async () => {
      mockConnections = [connection('connected'), connection('error')]

      const view = await render(<ConnectionsRoute />)

      expect(captured).not.toHaveBeenCalled()
      await view.unmount()
    })

    it('captures a completion, and a first bank-connection account, when a connection settles while polling', async () => {
      mockConnections = [connection('processing')]
      const view = await render(<ConnectionsRoute />)
      expect(captured).not.toHaveBeenCalled()

      mockConnections = [connection('connected')]
      await view.rerender(<ConnectionsRoute />)

      expect(captured.mock.calls).toEqual([
        ['first_account_created', { method: 'bank_connection' }],
        ['bank_connection_completed'],
      ])
      expect(JSON.stringify(captured.mock.calls)).not.toContain('Revolut')
      await view.unmount()
    })

    it('captures a failure with no error text when a connection errors or expires', async () => {
      mockConnections = [connection('processing')]
      const view = await render(<ConnectionsRoute />)

      mockConnections = [connection('expired')]
      await view.rerender(<ConnectionsRoute />)

      expect(captured.mock.calls).toEqual([['bank_connection_failed']])
      await view.unmount()
    })

    it('does not report a second connection as a first account', async () => {
      mockConnections = [connection('connected')]
      const view = await render(<ConnectionsRoute />)

      mockConnections = [connection('connected'), connection('connected')]
      await view.rerender(<ConnectionsRoute />)

      expect(captured.mock.calls).toEqual([['bank_connection_completed']])
      await view.unmount()
    })

    it('stays silent while the list is unchanged', async () => {
      mockConnections = [connection('connected')]
      const view = await render(<ConnectionsRoute />)
      await view.rerender(<ConnectionsRoute />)
      await view.rerender(<ConnectionsRoute />)

      expect(captured).not.toHaveBeenCalled()
      await view.unmount()
    })
  })

  it('navigates to the institution picker when connecting a bank', async () => {
    const view = await render(<ConnectionsRoute />)
    await fireEvent.press(view.getByRole('button', { name: 'ConnectBank' }))
    expect(mockPush).toHaveBeenCalledWith('/more/banking/connect')
  })

  it('surfaces the justStarted marker from the route params', async () => {
    mockParams = { justStarted: '1' }
    const view = await render(<ConnectionsRoute />)
    expect(view.getByTestId('justStarted')).toHaveTextContent('true')
  })

  it('passes on a known connection outcome and drops anything else', async () => {
    mockParams = { justStarted: '1', connection: 'success' }
    const view = await render(<ConnectionsRoute />)
    expect(view.getByTestId('connectionResult')).toHaveTextContent('success')

    mockParams = { justStarted: '1', connection: 'https://evil.example' }
    const other = await render(<ConnectionsRoute />)
    expect(other.getByTestId('connectionResult')).toHaveTextContent('null')
  })

  it('does not surface justStarted without the marker', async () => {
    const view = await render(<ConnectionsRoute />)
    expect(view.getByTestId('justStarted')).toHaveTextContent('false')
  })

  it('refreshes through the same query refetch as retry', async () => {
    const view = await render(<ConnectionsRoute />)
    await fireEvent.press(view.getByRole('button', { name: 'Refresh' }))
    expect(mockRefetch).toHaveBeenCalledTimes(1)
  })

  it('disconnects through the mutation and clears any prior failure', async () => {
    mockMutateAsync.mockResolvedValue(undefined)
    const view = await render(<ConnectionsRoute />)
    await fireEvent.press(view.getByRole('button', { name: 'Disconnect' }))
    expect(mockMutateAsync).toHaveBeenCalledWith(42)
    expect(view.getByTestId('disconnectFailure')).toHaveTextContent('none')
  })

  it('surfaces a classified failure when the disconnect mutation rejects', async () => {
    mockMutateAsync.mockRejectedValue(new ApiError('http', 404))
    const view = await render(<ConnectionsRoute />)
    await fireEvent.press(view.getByRole('button', { name: 'Disconnect' }))
    expect(view.getByTestId('disconnectFailure')).toHaveTextContent('42:not-found')
  })

  it('passes through the pending connection id while disconnecting', async () => {
    mockIsPending = true
    mockVariables = 42
    const view = await render(<ConnectionsRoute />)
    expect(view.getByTestId('disconnecting')).toHaveTextContent('42')
  })

  it('navigates to the statement import entry point', async () => {
    const view = await render(<ConnectionsRoute />)
    await fireEvent.press(view.getByRole('button', { name: 'ImportStatement' }))
    expect(mockPush).toHaveBeenCalledWith('/more/banking/import')
  })
})
