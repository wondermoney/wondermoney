import { fireEvent, render } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { initMobileI18n } from '@/lib/i18n'

import { ConnectBankScreen, type ConnectBankScreenProps } from './connect-bank-screen'

const rows = [
  { id: '1', name: 'Revolut', logo: 'https://logo/revolut.png' },
  { id: '2', name: 'N26', logo: 'https://logo/n26.png' },
]

async function setup(overrides: Partial<ConnectBankScreenProps> = {}) {
  const i18n = await initMobileI18n('en')
  const props: ConnectBankScreenProps = {
    state: { status: 'loaded', rows },
    pendingBankId: null,
    startFailure: null,
    onBack: jest.fn(),
    onRetry: jest.fn(),
    onSelectBank: jest.fn(),
    ...overrides,
  }
  const view = await render(<I18nextProvider i18n={i18n}><ConnectBankScreen {...props} /></I18nextProvider>)
  return { view, props }
}

describe('ConnectBankScreen', () => {
  it('shows a loading state', async () => {
    const { view } = await setup({ state: { status: 'loading' } })
    expect(view.getByRole('progressbar')).toBeOnTheScreen()
  })

  it('shows an error state with a working retry action', async () => {
    const { view, props } = await setup({ state: { status: 'error' } })
    await fireEvent.press(view.getByRole('button', { name: 'Retry' }))
    expect(props.onRetry).toHaveBeenCalledTimes(1)
  })

  it('lists every bank by name when loaded', async () => {
    const { view } = await setup()
    expect(view.getByText('Revolut')).toBeOnTheScreen()
    expect(view.getByText('N26')).toBeOnTheScreen()
  })

  it('filters the list as the user searches', async () => {
    const { view } = await setup()
    await fireEvent.changeText(view.getByLabelText('Search banks'), 'rev')
    expect(view.getByText('Revolut')).toBeOnTheScreen()
    expect(view.queryByText('N26')).not.toBeOnTheScreen()
  })

  it('shows a no-matches message when the search excludes every bank', async () => {
    const { view } = await setup()
    await fireEvent.changeText(view.getByLabelText('Search banks'), 'nonexistent-bank')
    expect(view.getByText('No banks match your search.')).toBeOnTheScreen()
  })

  it('starts a connection when a bank is pressed', async () => {
    const { view, props } = await setup()
    await fireEvent.press(view.getByRole('button', { name: 'Connect Revolut' }))
    expect(props.onSelectBank).toHaveBeenCalledWith(rows[0])
  })

  it('disables every row while a connection is starting', async () => {
    const { view } = await setup({ pendingBankId: '1' })
    expect(view.getByRole('button', { name: 'Connect Revolut' })).toBeDisabled()
    expect(view.getByRole('button', { name: 'Connect N26' })).toBeDisabled()
  })

  it('renders a translated message for each start failure', async () => {
    const { view } = await setup({ startFailure: 'mfa' })
    expect(view.getByRole('alert')).toHaveTextContent(/additional verification/i)
  })

  it('invokes onBack from the back action', async () => {
    const { view, props } = await setup()
    await fireEvent.press(view.getByRole('button', { name: 'Back to bank connections' }))
    expect(props.onBack).toHaveBeenCalledTimes(1)
  })
})
