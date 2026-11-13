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
  bankId: 'UFQ6OlJldm9sdXQ',
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
let mockVariables: { connectionId: number; provider: string } | undefined
let mockFeatures: { bankSyncProviders?: string[] } = {}
jest.mock('@/lib/server/use-instance', () => ({
  useConfirmedFeature: (select: (features: { bankSyncProviders?: string[] }) => boolean | undefined) => select(mockFeatures) === true,
}))

const mockStartMutate = jest.fn()
let mockStartPending = false
let mockStartVariables: string | undefined
const mockOpenAuthSessionAsync = jest.fn()
jest.mock('expo-web-browser', () => ({
  openAuthSessionAsync: (...args: unknown[]) => mockOpenAuthSessionAsync(...args),
}))
jest.mock('../use-start-bank-connection', () => ({
  useStartBankConnection: () => ({ mutate: mockStartMutate, isPending: mockStartPending, variables: mockStartVariables }),
  classifyStartBankConnectionFailure: jest.requireActual('../use-start-bank-connection').classifyStartBankConnectionFailure,
}))

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
    onConnectSimplefin?: () => void
    onBack: () => void
    onRefresh: () => void
    onDisconnect: (target: { connectionId: number; provider: string }) => Promise<void>
    onViewHistory: (target: { connectionId: number; provider: string }, institutionName: string | null) => void
    disconnectingConnection: { connectionId: number; provider: string } | null
    disconnectFailure: { connectionId: number; provider: string; failure: string } | null
    onImportStatement: () => void
    onReconnect: (bankId: string) => void
    reconnectingBankId: string | null
    reconnectFailure: { bankId: string; failure: string } | null
  }) => {
    const Native = jest.requireActual<typeof import('react-native')>('react-native')
    return (
      <>
        <Native.Text testID="justStarted">{String(props.justStarted)}</Native.Text>
        <Native.Text testID="connectionResult">{String(props.connectionResult)}</Native.Text>
        <Native.Text testID="disconnecting">{props.disconnectingConnection ? `${props.disconnectingConnection.provider}:${props.disconnectingConnection.connectionId}` : 'null'}</Native.Text>
        <Native.Text testID="disconnectFailure">{props.disconnectFailure ? `${props.disconnectFailure.provider}:${props.disconnectFailure.connectionId}:${props.disconnectFailure.failure}` : 'none'}</Native.Text>
        {props.onConnectSimplefin ? (
          <Native.Pressable accessibilityRole="button" accessibilityLabel="ConnectSimplefin" onPress={props.onConnectSimplefin}><Native.Text>Connect SimpleFIN</Native.Text></Native.Pressable>
        ) : null}
        <Native.Pressable accessibilityRole="button" accessibilityLabel="SimplefinHistory" onPress={() => props.onViewHistory({ connectionId: 7, provider: 'SimpleFIN' }, 'Credit Union')}><Native.Text>SimpleFIN history</Native.Text></Native.Pressable>
        <Native.Pressable accessibilityRole="button" accessibilityLabel="EnableBankingHistory" onPress={() => props.onViewHistory({ connectionId: 7, provider: 'EnableBanking' }, null)}><Native.Text>Enable Banking history</Native.Text></Native.Pressable>
        <Native.Pressable accessibilityRole="button" accessibilityLabel="DisconnectSimplefin" onPress={() => void props.onDisconnect({ connectionId: 7, provider: 'SimpleFIN' })}><Native.Text>Disconnect SimpleFIN</Native.Text></Native.Pressable>
        <Native.Pressable accessibilityRole="button" accessibilityLabel="ConnectBank" onPress={props.onConnectBank}><Native.Text>Connect</Native.Text></Native.Pressable>
        <Native.Pressable accessibilityRole="button" accessibilityLabel="Refresh" onPress={props.onRefresh}><Native.Text>Refresh</Native.Text></Native.Pressable>
        <Native.Pressable accessibilityRole="button" accessibilityLabel="Disconnect" onPress={() => void props.onDisconnect({ connectionId: 42, provider: 'EnableBanking' })}><Native.Text>Disconnect</Native.Text></Native.Pressable>
        <Native.Pressable accessibilityRole="button" accessibilityLabel="ImportStatement" onPress={props.onImportStatement}><Native.Text>Import statement</Native.Text></Native.Pressable>
        <Native.Text testID="reconnecting">{String(props.reconnectingBankId)}</Native.Text>
        <Native.Text testID="reconnectFailure">{props.reconnectFailure ? `${props.reconnectFailure.bankId}:${props.reconnectFailure.failure}` : 'none'}</Native.Text>
        <Native.Pressable accessibilityRole="button" accessibilityLabel="Reconnect" onPress={() => props.onReconnect('UFQ6OlJldm9sdXQ')}><Native.Text>Reconnect</Native.Text></Native.Pressable>
      </>
    )
  },
}))

describe('ConnectionsRoute', () => {
  beforeEach(() => {
    mockReplace.mockClear(); mockPush.mockClear(); mockBack.mockClear(); mockCanGoBack.mockReset().mockReturnValue(true)
    mockRefetch.mockClear(); mockParams = {}
    mockMutateAsync.mockReset(); mockIsPending = false; mockVariables = undefined; mockFeatures = {}
    mockConnections = []; captured.mockClear()
    mockStartMutate.mockReset(); mockStartPending = false; mockStartVariables = undefined
    mockOpenAuthSessionAsync.mockReset()
  })

  describe('reconnecting a bank', () => {
    it('starts a new connection for the bank, opens its consent and returns to the list with the outcome', async () => {
      mockOpenAuthSessionAsync.mockResolvedValue({ type: 'success', url: 'wondermoney://more/banking?enableBankingConnection=success' })
      mockStartMutate.mockImplementation((_bankId: string, options: { onSuccess: (data: { redirectUrl: string }) => void }) => {
        options.onSuccess({ redirectUrl: 'https://bank.example/consent' })
      })
      const view = await render(<ConnectionsRoute />)

      await fireEvent.press(view.getByRole('button', { name: 'Reconnect' }))
      await Promise.resolve()

      expect(mockStartMutate).toHaveBeenCalledWith('UFQ6OlJldm9sdXQ', expect.anything())
      expect(mockOpenAuthSessionAsync).toHaveBeenCalledWith('https://bank.example/consent', 'wondermoney://more/banking')
      expect(mockReplace).toHaveBeenCalledWith({ pathname: '/more/banking', params: { justStarted: '1', connection: 'success' } })
      expect(captured.mock.calls).toEqual([['bank_connection_started']])
    })

    it('shows a classified failure on the row when the connection cannot start', async () => {
      mockStartMutate.mockImplementation((_bankId: string, options: { onError: (error: unknown) => void }) => {
        options.onError(new ApiError('http', 404))
      })
      const view = await render(<ConnectionsRoute />)

      await fireEvent.press(view.getByRole('button', { name: 'Reconnect' }))

      expect(view.getByTestId('reconnectFailure')).toHaveTextContent('UFQ6OlJldm9sdXQ:not-found')
      expect(mockOpenAuthSessionAsync).not.toHaveBeenCalled()
    })

    it('passes through the bank being reconnected while it starts', async () => {
      mockStartPending = true
      mockStartVariables = 'UFQ6OlJldm9sdXQ'
      const view = await render(<ConnectionsRoute />)
      expect(view.getByTestId('reconnecting')).toHaveTextContent('UFQ6OlJldm9sdXQ')
    })
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
    expect(mockMutateAsync).toHaveBeenCalledWith({ connectionId: 42, provider: 'EnableBanking' })
    expect(view.getByTestId('disconnectFailure')).toHaveTextContent('none')
  })

  it('surfaces a classified failure when the disconnect mutation rejects', async () => {
    mockMutateAsync.mockRejectedValue(new ApiError('http', 404))
    const view = await render(<ConnectionsRoute />)
    await fireEvent.press(view.getByRole('button', { name: 'Disconnect' }))
    expect(view.getByTestId('disconnectFailure')).toHaveTextContent('EnableBanking:42:not-found')
  })

  it('passes through the pending connection id while disconnecting', async () => {
    mockIsPending = true
    mockVariables = { connectionId: 42, provider: 'EnableBanking' }
    const view = await render(<ConnectionsRoute />)
    expect(view.getByTestId('disconnecting')).toHaveTextContent('EnableBanking:42')
  })

  it('navigates to the statement import entry point', async () => {
    const view = await render(<ConnectionsRoute />)
    await fireEvent.press(view.getByRole('button', { name: 'ImportStatement' }))
    expect(mockPush).toHaveBeenCalledWith('/more/banking/import')
  })

  describe('SimpleFIN', () => {
    it('hides Connect with SimpleFIN unless the server lists the simplefin provider', async () => {
      mockFeatures = { bankSyncProviders: ['enable_banking'] }
      const without = await render(<ConnectionsRoute />)
      expect(without.queryByRole('button', { name: 'ConnectSimplefin' })).not.toBeOnTheScreen()
      await without.unmount()

      mockFeatures = {}
      const older = await render(<ConnectionsRoute />)
      expect(older.queryByRole('button', { name: 'ConnectSimplefin' })).not.toBeOnTheScreen()
    })

    it('offers Connect with SimpleFIN when the server enables it, and opens its token screen', async () => {
      mockFeatures = { bankSyncProviders: ['enable_banking', 'simplefin'] }
      const view = await render(<ConnectionsRoute />)
      await fireEvent.press(view.getByRole('button', { name: 'ConnectSimplefin' }))
      expect(mockPush).toHaveBeenCalledWith('/more/banking/simplefin/connect')
    })

    it('carries the SimpleFIN provider into the history route, and leaves it out for Enable Banking', async () => {
      const view = await render(<ConnectionsRoute />)
      await fireEvent.press(view.getByRole('button', { name: 'SimplefinHistory' }))
      expect(mockPush).toHaveBeenLastCalledWith({ pathname: '/more/banking/history', params: { connectionId: '7', provider: 'SimpleFIN', institutionName: 'Credit Union' } })
      await fireEvent.press(view.getByRole('button', { name: 'EnableBankingHistory' }))
      expect(mockPush).toHaveBeenLastCalledWith({ pathname: '/more/banking/history', params: { connectionId: '7' } })
    })

    it('disconnects a SimpleFIN connection with its provider and keys the failure by it', async () => {
      mockMutateAsync.mockRejectedValue(new ApiError('http', 404))
      const view = await render(<ConnectionsRoute />)
      await fireEvent.press(view.getByRole('button', { name: 'DisconnectSimplefin' }))
      expect(mockMutateAsync).toHaveBeenCalledWith({ connectionId: 7, provider: 'SimpleFIN' })
      expect(view.getByTestId('disconnectFailure')).toHaveTextContent('SimpleFIN:7:not-found')
    })
  })
})
