import { fireEvent, render } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { initMobileI18n } from '@/lib/i18n'
import { themeTokens } from '@/theme/tokens'

import { AppLockSection } from './app-lock-section'

const palette = themeTokens.colors.light

async function renderSection(overrides: Partial<React.ComponentProps<typeof AppLockSection>> = {}) {
  const i18n = await initMobileI18n('en')
  const props: React.ComponentProps<typeof AppLockSection> = {
    isLoaded: true,
    enabled: false,
    pending: false,
    failure: null,
    onTurnOn: jest.fn(),
    onTurnOff: jest.fn(),
    palette,
    ...overrides,
  }
  const view = await render(<I18nextProvider i18n={i18n}><AppLockSection {...props} /></I18nextProvider>)
  return { view, props }
}

describe('AppLockSection', () => {
  it('shows a loading indicator while the preference is still loading', async () => {
    const { view } = await renderSection({ isLoaded: false })
    expect(view.getByRole('progressbar')).toBeOnTheScreen()
  })

  it('offers to turn on app lock when off', async () => {
    const onTurnOn = jest.fn()
    const { view } = await renderSection({ enabled: false, onTurnOn })
    expect(view.getByText('App lock is off')).toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Turn on app lock' }))
    expect(onTurnOn).toHaveBeenCalledTimes(1)
  })

  it('offers to turn off app lock when on', async () => {
    const onTurnOff = jest.fn()
    const { view } = await renderSection({ enabled: true, onTurnOff })
    expect(view.getByText('App lock is on')).toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Turn off app lock' }))
    expect(onTurnOff).toHaveBeenCalledTimes(1)
  })

  it('disables the action and shows a busy label while pending', async () => {
    const { view } = await renderSection({ enabled: false, pending: true })
    expect(view.getByRole('button', { name: 'Turning on…' })).toBeDisabled()
  })

  it.each([
    ['no-hardware', /no biometric or passcode/i],
    ['not-enrolled', /set up face id/i],
    ['auth-failed', /could not confirm/i],
  ] as const)('surfaces the %s failure', async (failure, matcher) => {
    const { view } = await renderSection({ failure })
    expect(view.getByRole('alert')).toHaveTextContent(matcher)
  })
})
