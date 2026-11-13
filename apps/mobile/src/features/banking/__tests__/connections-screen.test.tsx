import { act, fireEvent, render } from '@testing-library/react-native'
import { Alert } from 'react-native'
import { I18nextProvider } from 'react-i18next'

import { initMobileI18n } from '@/lib/i18n'

import { bankConnectionsResponseSchema } from '../connection-status-contract'
import { mapBankConnections, type BankConnectionRow } from '../connection-status-view-model'
import { ConnectionsScreen, type ConnectionsScreenState } from '../connections-screen'

const row = (over: Partial<BankConnectionRow> = {}): BankConnectionRow => ({
  accessType: 'open_banking',
  bankId: null,
  connectionId: 42,
  dataFreshAsOf: null,
  daysUntilExpiry: null,
  expiresAt: null,
  institutionName: 'Real Bank',
  lastError: null,
  provider: 'GoCardless',
  status: 'connected',
  ...over,
})

const loadedState = (rows: readonly BankConnectionRow[]): ConnectionsScreenState => ({ status: 'loaded', rows })

const baseProps = {
  onBack: jest.fn(),
  onRetry: jest.fn(),
}

const renderScreen = async (props: Partial<Parameters<typeof ConnectionsScreen>[0]> & { state: ConnectionsScreenState }) => {
  const i18n = await initMobileI18n('en')
  return render(<I18nextProvider i18n={i18n}><ConnectionsScreen {...baseProps} {...props} /></I18nextProvider>)
}

describe('ConnectionsScreen disconnect', () => {
  afterEach(() => jest.restoreAllMocks())

  it('does not render a disconnect action when no onDisconnect handler is supplied', async () => {
    const view = await renderScreen({ state: loadedState([row()]) })
    expect(view.queryByRole('button', { name: /^disconnect/i })).not.toBeOnTheScreen()
  })

  it('does not render a disconnect action for a row with no connectionId', async () => {
    const onDisconnect = jest.fn()
    const view = await renderScreen({ state: loadedState([row({ connectionId: null })]), onDisconnect })
    expect(view.queryByRole('button', { name: /^disconnect/i })).not.toBeOnTheScreen()
  })

  it('asks for confirmation before disconnecting', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(jest.fn())
    const onDisconnect = jest.fn().mockResolvedValue(undefined)
    const view = await renderScreen({ state: loadedState([row()]), onDisconnect })
    await fireEvent.press(view.getByRole('button', { name: 'Disconnect Real Bank' }))
    expect(alert).toHaveBeenCalledWith('Disconnect Real Bank?', expect.stringContaining('Real Bank'), expect.anything(), expect.anything())
    expect(onDisconnect).not.toHaveBeenCalled()
  })

  it('disconnects only after explicit confirmation', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(jest.fn())
    const onDisconnect = jest.fn().mockResolvedValue(undefined)
    const view = await renderScreen({ state: loadedState([row()]), onDisconnect })
    await fireEvent.press(view.getByRole('button', { name: 'Disconnect Real Bank' }))
    const buttons = alert.mock.calls[0]![2]!
    await act(async () => { buttons[1]?.onPress?.(); await Promise.resolve() })
    expect(onDisconnect).toHaveBeenCalledWith({ connectionId: 42, provider: 'GoCardless' })
  })

  it('does not disconnect when the confirmation is cancelled', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(jest.fn())
    const onDisconnect = jest.fn().mockResolvedValue(undefined)
    const view = await renderScreen({ state: loadedState([row()]), onDisconnect })
    await fireEvent.press(view.getByRole('button', { name: 'Disconnect Real Bank' }))
    const buttons = alert.mock.calls[0]![2]!
    await act(() => buttons[0]?.onPress?.())
    expect(onDisconnect).not.toHaveBeenCalled()
  })

  it('disables the disconnect action and shows a busy label while pending for that row', async () => {
    const onDisconnect = jest.fn().mockResolvedValue(undefined)
    const view = await renderScreen({ state: loadedState([row()]), onDisconnect, disconnectingConnection: { connectionId: 42, provider: 'GoCardless' } })
    expect(view.getByRole('button', { name: 'Disconnect Real Bank' })).toBeDisabled()
    expect(view.getByText('Disconnecting…')).toBeOnTheScreen()
  })

  it('shows a row-scoped failure message that matches the failed connection', async () => {
    const onDisconnect = jest.fn().mockResolvedValue(undefined)
    const view = await renderScreen({
      state: loadedState([row(), row({ connectionId: 43, institutionName: 'Other Bank' })]),
      onDisconnect,
      disconnectFailure: { connectionId: 42, provider: 'GoCardless', failure: 'not-found' },
    })
    expect(view.getByText('That connection is no longer available.')).toBeOnTheScreen()
  })

  it('explains the empty state and keeps the open-banking read-only boundary visible', async () => {
    const view = await renderScreen({ state: loadedState([]), onConnectBank: jest.fn() })
    expect(view.getByRole('header', { name: 'No bank connections yet' })).toBeOnTheScreen()
    expect(view.getByText(/Open Banking access is read-only/)).toBeOnTheScreen()
    expect(view.getByRole('button', { name: 'Connect a bank' })).toBeOnTheScreen()
  })
})

describe('ConnectionsScreen import-statement fallback', () => {
  it('does not render the fallback for a connected row', async () => {
    const view = await renderScreen({ state: loadedState([row({ status: 'connected' })]), onImportStatement: jest.fn() })
    expect(view.queryByRole('button', { name: /import a statement/i })).not.toBeOnTheScreen()
  })

  it('does not render the fallback for an error row when no handler is supplied', async () => {
    const view = await renderScreen({ state: loadedState([row({ status: 'error' })]) })
    expect(view.queryByRole('button', { name: /import a statement/i })).not.toBeOnTheScreen()
  })

  it('offers the fallback for an error row and navigates through the handler', async () => {
    const onImportStatement = jest.fn()
    const view = await renderScreen({ state: loadedState([row({ status: 'error' })]), onImportStatement })
    const button = view.getByRole('button', { name: 'Import a statement for Real Bank instead' })
    await fireEvent.press(button)
    expect(onImportStatement).toHaveBeenCalledTimes(1)
  })
})

describe('ConnectionsScreen reconnect', () => {
  const reconnectable = (over: Partial<BankConnectionRow> = {}) => row({ bankId: 'UFQ6OlJlYWwgQmFuaw', provider: 'EnableBanking', ...over })

  it.each(['expiring', 'expired', 'revoked'] as const)('offers Reconnect on a %s connection and starts it for that bank', async (status) => {
    const onReconnect = jest.fn()
    const view = await renderScreen({ state: loadedState([reconnectable({ daysUntilExpiry: 5, status })]), onReconnect })
    await fireEvent.press(view.getByRole('button', { name: 'Reconnect Real Bank' }))
    expect(onReconnect).toHaveBeenCalledWith('UFQ6OlJlYWwgQmFuaw')
  })

  it('does not offer Reconnect on a working connection, or on one with no bank id', async () => {
    const onReconnect = jest.fn()
    const view = await renderScreen({
      state: loadedState([reconnectable({ status: 'connected' }), reconnectable({ bankId: null, connectionId: 43, institutionName: 'Old Bank', status: 'expired' })]),
      onReconnect,
    })
    expect(view.queryByRole('button', { name: /^reconnect/i })).not.toBeOnTheScreen()
  })

  it('says how many days an expiring consent has left, and that a bank ended one early', async () => {
    const view = await renderScreen({
      state: loadedState([reconnectable({ daysUntilExpiry: 5, status: 'expiring' }), reconnectable({ connectionId: 43, institutionName: 'Other Bank', status: 'revoked' })]),
      onReconnect: jest.fn(),
    })
    expect(view.getByText(/5 days/)).toBeOnTheScreen()
    expect(view.getByText('Ended by bank')).toBeOnTheScreen()
  })

  it('disables Reconnect while a connection is starting and shows why one failed', async () => {
    const view = await renderScreen({
      state: loadedState([reconnectable({ status: 'expired' })]),
      onReconnect: jest.fn(),
      reconnectingBankId: 'UFQ6OlJlYWwgQmFuaw',
      reconnectFailure: { bankId: 'UFQ6OlJlYWwgQmFuaw', failure: 'not-found' },
    })
    expect(view.getByRole('button', { name: 'Reconnect Real Bank' })).toBeDisabled()
    expect(view.getByRole('alert')).toHaveTextContent('That bank is no longer available. Choose another one.')
  })
})

describe('ConnectionsScreen with values this build does not know', () => {
  it('renders a row whose provider and status are new to this build alongside known rows', async () => {
    const response = bankConnectionsResponseSchema.parse({ connections: [
      { accessType: 'open_banking', dataFreshAsOf: null, expiresAt: null, institutionName: 'New Bank', provider: 'Plaid', status: 'reauthorizing', region: 'eu' },
      { accessType: 'open_banking', dataFreshAsOf: null, expiresAt: null, institutionName: 'Real Bank', provider: 'GoCardless', status: 'connected' },
    ] })
    const view = await renderScreen({ state: loadedState(mapBankConnections(response.connections)) })
    expect(view.getByText('New Bank')).toBeOnTheScreen()
    expect(view.getByText('Status unavailable')).toBeOnTheScreen()
    expect(view.getByText('Real Bank')).toBeOnTheScreen()
    expect(view.getByText('Connected')).toBeOnTheScreen()
  })
})

describe('ConnectionsScreen after returning from the bank', () => {
  const waitingTitle = async () => (await initMobileI18n('en')).t('banking.connections.justStarted.title')

  it('announces a failed connection as an alert instead of the waiting notice', async () => {
    const view = await renderScreen({ state: loadedState([]), justStarted: true, connectionResult: 'error' })
    expect(view.getByRole('alert')).toBeOnTheScreen()
    expect(view.queryByText(await waitingTitle())).not.toBeOnTheScreen()
  })

  it('confirms a successful connection without raising an alert', async () => {
    const view = await renderScreen({ state: loadedState([]), justStarted: true, connectionResult: 'success' })
    expect(view.queryByRole('alert')).not.toBeOnTheScreen()
    expect(view.queryByText(await waitingTitle())).not.toBeOnTheScreen()
  })

  it('shows the waiting notice when the outcome is unknown', async () => {
    const view = await renderScreen({ state: loadedState([]), justStarted: true, connectionResult: null })
    expect(view.getByText(await waitingTitle())).toBeOnTheScreen()
  })
})

describe('ConnectionsScreen row title', () => {
  it('names an unnamed connection by its provider, and falls back to the generic label', async () => {
    const view = await renderScreen({ state: loadedState([row({ institutionName: null }), row({ connectionId: 43, institutionName: null, provider: 'unknown' })]) })
    expect(view.getByText('GoCardless connection')).toBeOnTheScreen()
    expect(view.getByText('Bank connection')).toBeOnTheScreen()
  })

  it('shows a back control instead of a plain text link', async () => {
    const view = await renderScreen({ state: loadedState([row()]) })
    expect(view.getByRole('button', { name: 'Back to More' })).toBeOnTheScreen()
  })
})

describe('ConnectionsScreen with SimpleFIN', () => {
  const simplefin = (over: Partial<BankConnectionRow> = {}) => row({ connectionId: 7, institutionName: 'Credit Union', provider: 'SimpleFIN', ...over })

  it('offers Connect with SimpleFIN only when the route passes the handler', async () => {
    const hidden = await renderScreen({ state: loadedState([]), onConnectBank: jest.fn() })
    expect(hidden.queryByRole('button', { name: /simplefin/i })).not.toBeOnTheScreen()

    const onConnectSimplefin = jest.fn()
    const shown = await renderScreen({ state: loadedState([]), onConnectBank: jest.fn(), onConnectSimplefin })
    await fireEvent.press(shown.getByRole('button', { name: /simplefin/i }))
    expect(onConnectSimplefin).toHaveBeenCalledTimes(1)
  })

  it('opens the history and disconnects with the SimpleFIN provider, so the SimpleFIN routes are used', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(jest.fn())
    const onViewHistory = jest.fn()
    const onDisconnect = jest.fn().mockResolvedValue(undefined)
    const view = await renderScreen({ state: loadedState([simplefin()]), onViewHistory, onDisconnect })

    await fireEvent.press(view.getByRole('button', { name: 'Sync history for Credit Union' }))
    expect(onViewHistory).toHaveBeenCalledWith({ connectionId: 7, provider: 'SimpleFIN' }, 'Credit Union')

    await fireEvent.press(view.getByRole('button', { name: 'Disconnect Credit Union' }))
    await act(async () => { alert.mock.calls[0]![2]![1]?.onPress?.(); await Promise.resolve() })
    expect(onDisconnect).toHaveBeenCalledWith({ connectionId: 7, provider: 'SimpleFIN' })
    alert.mockRestore()
  })

  it('keeps a SimpleFIN row and an Enable Banking row with the same id apart', async () => {
    const view = await renderScreen({
      state: loadedState([simplefin(), row({ connectionId: 7, institutionName: 'Euro Bank', provider: 'EnableBanking' })]),
      onDisconnect: jest.fn().mockResolvedValue(undefined),
      disconnectingConnection: { connectionId: 7, provider: 'SimpleFIN' },
      disconnectFailure: { connectionId: 7, provider: 'SimpleFIN', failure: 'not-found' },
    })
    expect(view.getByRole('button', { name: 'Disconnect Credit Union' })).toBeDisabled()
    expect(view.getByRole('button', { name: 'Disconnect Euro Bank' })).not.toBeDisabled()
    expect(view.getAllByText('That connection is no longer available.')).toHaveLength(1)
  })

  it('names an unnamed SimpleFIN connection by the provider and shows no consent expiry', async () => {
    const i18n = await initMobileI18n('en')
    const view = await renderScreen({ state: loadedState([simplefin({ institutionName: null })]) })
    expect(view.getByText(/SimpleFIN/)).toBeOnTheScreen()
    expect(view.queryByText(i18n.t('banking.connections.expiresOn', { date: i18n.t('banking.connections.unavailableDate') }))).not.toBeOnTheScreen()
  })

  it('offers no Reconnect on a revoked SimpleFIN connection and says to connect again with a new token', async () => {
    const i18n = await initMobileI18n('en')
    const view = await renderScreen({ state: loadedState([simplefin({ bankId: 'ignored', status: 'revoked' })]), onReconnect: jest.fn() })
    expect(view.queryByRole('button', { name: /^reconnect/i })).not.toBeOnTheScreen()
    expect(view.getByText(i18n.t('banking.connections.simplefin.accessEnded'))).toBeOnTheScreen()
    expect(view.queryByText(i18n.t('banking.connections.consent.revoked'))).not.toBeOnTheScreen()
  })
})
