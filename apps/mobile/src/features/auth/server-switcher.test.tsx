import { fireEvent, render, waitFor } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { ServerSwitchProvider } from '@/components/providers/server-switch-provider'
import { initMobileI18n } from '@/lib/i18n'

import { ServerSwitcher } from './server-switcher'

jest.mock('expo-application', () => ({ nativeApplicationVersion: '1.0.0' }))

const instanceBody = (minAppVersion: string | null = null) => ({
  apiVersion: 1,
  features: { ai: { assistant: false, csvMapping: false, enrichment: false, monthlyStory: false, ocr: false }, bankSync: true, contactForm: false, email: false, fileStorage: false, marketData: false },
  minAppVersion,
  name: 'Casa',
  signupMode: 'open',
})

async function renderSwitcher(fetchImpl: jest.Mock, usesDefaultServer = true) {
  const i18n = await initMobileI18n('en')
  const switchServer = jest.fn().mockResolvedValue(undefined)
  const view = await render(
    <I18nextProvider i18n={i18n}>
      <ServerSwitchProvider value={{ apiBaseUrl: 'https://api.wonder.money', switchServer, usesDefaultServer }}>
        <ServerSwitcher appVersion="1.0.0" fetchImpl={fetchImpl as unknown as typeof fetch} />
      </ServerSwitchProvider>
    </I18nextProvider>,
  )
  return { switchServer, view }
}

describe('ServerSwitcher', () => {
  it('shows the current server', async () => {
    const { view } = await renderSwitcher(jest.fn())
    expect(view.getByText('Server: api.wonder.money')).toBeOnTheScreen()
  })

  it('switches to a server that answers as WonderMoney', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ json: () => Promise.resolve(instanceBody()), ok: true })
    const { switchServer, view } = await renderSwitcher(fetchImpl)

    await fireEvent.press(view.getByText('Use a different server'))
    await fireEvent.changeText(view.getByLabelText('Server address'), 'money.example.com')
    await fireEvent.press(view.getByText('Connect'))

    await waitFor(() => expect(switchServer).toHaveBeenCalledWith('https://money.example.com'))
    expect(fetchImpl).toHaveBeenCalledWith('https://money.example.com/v1/instance', expect.anything())
  })

  it('keeps the current server when the address is not a WonderMoney server', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ json: () => Promise.resolve({}), ok: true })
    const { switchServer, view } = await renderSwitcher(fetchImpl)

    await fireEvent.press(view.getByText('Use a different server'))
    await fireEvent.changeText(view.getByLabelText('Server address'), 'example.com')
    await fireEvent.press(view.getByText('Connect'))

    expect(await view.findByText("That address isn't a WonderMoney server.")).toBeOnTheScreen()
    expect(switchServer).not.toHaveBeenCalled()
  })

  it('asks for an app update when the server needs a newer version', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ json: () => Promise.resolve(instanceBody('2.0.0')), ok: true })
    const { switchServer, view } = await renderSwitcher(fetchImpl)

    await fireEvent.press(view.getByText('Use a different server'))
    await fireEvent.changeText(view.getByLabelText('Server address'), 'money.example.com')
    await fireEvent.press(view.getByText('Connect'))

    expect(await view.findByText(/needs app version 2\.0\.0/)).toBeOnTheScreen()
    expect(switchServer).not.toHaveBeenCalled()
  })

  it('offers a way back to the default server', async () => {
    const { switchServer, view } = await renderSwitcher(jest.fn(), false)
    await fireEvent.press(view.getByText('Use the default server'))
    expect(switchServer).toHaveBeenCalledWith(null)
  })
})
