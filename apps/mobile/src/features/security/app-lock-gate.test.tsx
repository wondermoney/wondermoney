import { fireEvent, render } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'
import { Text } from 'react-native'

import { initMobileI18n } from '@/lib/i18n'

import { AppLockGate } from './app-lock-gate'

const mockUnlock = jest.fn()
let mockAppLock: { isLoaded: boolean; enabled: boolean; locked: boolean; unlock: typeof mockUnlock } = {
  isLoaded: true, enabled: false, locked: false, unlock: mockUnlock,
}

jest.mock('@/components/providers/app-lock-provider', () => ({ useAppLock: () => mockAppLock }))

async function renderGate() {
  const i18n = await initMobileI18n('en')
  return render(<I18nextProvider i18n={i18n}><AppLockGate><Text>Protected content</Text></AppLockGate></I18nextProvider>)
}

describe('AppLockGate', () => {
  beforeEach(() => { mockUnlock.mockReset() })

  it('renders nothing while the preference is still loading', async () => {
    mockAppLock = { isLoaded: false, enabled: false, locked: false, unlock: mockUnlock }
    const view = await renderGate()
    expect(view.toJSON()).toBeNull()
  })

  it('renders children when app lock is disabled', async () => {
    mockAppLock = { isLoaded: true, enabled: false, locked: false, unlock: mockUnlock }
    const view = await renderGate()
    expect(view.getByText('Protected content')).toBeOnTheScreen()
  })

  it('renders children when enabled but currently unlocked', async () => {
    mockAppLock = { isLoaded: true, enabled: true, locked: false, unlock: mockUnlock }
    const view = await renderGate()
    expect(view.getByText('Protected content')).toBeOnTheScreen()
  })

  it('blocks children behind a lock screen when enabled and locked', async () => {
    mockAppLock = { isLoaded: true, enabled: true, locked: true, unlock: mockUnlock }
    const view = await renderGate()
    expect(view.queryByText('Protected content')).not.toBeOnTheScreen()
    expect(view.getByText('WonderMoney is locked')).toBeOnTheScreen()
  })

  it('unlocks via the gate and clears a prior failure on retry', async () => {
    mockAppLock = { isLoaded: true, enabled: true, locked: true, unlock: mockUnlock }
    mockUnlock.mockResolvedValueOnce(false)
    const view = await renderGate()
    await fireEvent.press(view.getByRole('button', { name: 'Unlock' }))
    expect(mockUnlock).toHaveBeenCalledWith('Unlock WonderMoney')
    expect(view.getByRole('alert')).toHaveTextContent(/could not unlock/i)

    mockUnlock.mockResolvedValueOnce(true)
    await fireEvent.press(view.getByRole('button', { name: 'Unlock' }))
    expect(view.queryByRole('alert')).not.toBeOnTheScreen()
  })
})
