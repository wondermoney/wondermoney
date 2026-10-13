import { fireEvent, render } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { initMobileI18n } from '@/lib/i18n'

import { AppLockScreen } from './app-lock-screen'

async function renderScreen(overrides: Partial<React.ComponentProps<typeof AppLockScreen>> = {}) {
  const i18n = await initMobileI18n('en')
  const props: React.ComponentProps<typeof AppLockScreen> = { pending: false, failed: false, onUnlock: jest.fn(), ...overrides }
  const view = await render(<I18nextProvider i18n={i18n}><AppLockScreen {...props} /></I18nextProvider>)
  return { view, props }
}

describe('AppLockScreen', () => {
  it('shows the lock heading and an unlock action', async () => {
    const onUnlock = jest.fn()
    const { view } = await renderScreen({ onUnlock })
    expect(view.getByText('WonderMoney is locked')).toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Unlock' }))
    expect(onUnlock).toHaveBeenCalledTimes(1)
  })

  it('disables the action and shows a busy label while pending', async () => {
    const { view } = await renderScreen({ pending: true })
    expect(view.getByRole('button', { name: 'Unlocking…' })).toBeDisabled()
  })

  it('shows a failure message after a declined or failed prompt', async () => {
    const { view } = await renderScreen({ failed: true })
    expect(view.getByRole('alert')).toHaveTextContent(/could not unlock/i)
  })
})
