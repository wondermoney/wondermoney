import { act, fireEvent, render } from '@testing-library/react-native'
import { Alert } from 'react-native'
import { I18nextProvider } from 'react-i18next'

import { initMobileI18n } from '@/lib/i18n'

import { bankConnectionsResponseSchema } from '../connection-status-contract'
import { mapBankConnections, type BankConnectionRow } from '../connection-status-view-model'
import { ConnectionsScreen, type ConnectionsScreenState } from '../connections-screen'

const row = (over: Partial<BankConnectionRow> = {}): BankConnectionRow => ({
  accessType: 'open_banking',
  connectionId: 42,
  dataFreshAsOf: null,
  expiresAt: null,
  institutionName: 'Real Bank',
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
    expect(view.queryByRole('button', { name: /disconnect/i })).not.toBeOnTheScreen()
  })

  it('does not render a disconnect action for a row with no connectionId', async () => {
    const onDisconnect = jest.fn()
    const view = await renderScreen({ state: loadedState([row({ connectionId: null })]), onDisconnect })
    expect(view.queryByRole('button', { name: /disconnect/i })).not.toBeOnTheScreen()
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
    expect(onDisconnect).toHaveBeenCalledWith(42)
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
    const view = await renderScreen({ state: loadedState([row()]), onDisconnect, disconnectingConnectionId: 42 })
    expect(view.getByRole('button', { name: 'Disconnect Real Bank' })).toBeDisabled()
    expect(view.getByText('Disconnecting…')).toBeOnTheScreen()
  })

  it('shows a row-scoped failure message that matches the failed connection', async () => {
    const onDisconnect = jest.fn().mockResolvedValue(undefined)
    const view = await renderScreen({
      state: loadedState([row(), row({ connectionId: 43, institutionName: 'Other Bank' })]),
      onDisconnect,
      disconnectFailure: { connectionId: 42, failure: 'not-found' },
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
