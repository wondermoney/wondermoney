import { fireEvent, render } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { Amount } from '@/components/ui/amount'
import { initMobileI18n } from '@/lib/i18n'
import { memoryPreferenceStorage, PrivacyModeProvider } from '@/test/privacy-mode'

import { PreferencesScreen } from './preferences-screen'

jest.mock('expo-router', () => ({ useRouter: () => ({ back: jest.fn() }) }))

describe('PreferencesScreen: privacy mode', () => {
  it('switches amounts off and on, and saves each choice on the device', async () => {
    const i18n = await initMobileI18n('en')
    const storage = memoryPreferenceStorage(null)
    const view = await render(
      <I18nextProvider i18n={i18n}>
        <PrivacyModeProvider storage={storage}>
          <PreferencesScreen />
          <Amount currency="EUR" locale="en" value={42} />
        </PrivacyModeProvider>
      </I18nextProvider>,
    )

    const toggle = view.getByTestId('preferences-privacy-mode')
    expect(toggle.props.value).toBe(false)
    expect(view.getByLabelText('€42.00')).toBeOnTheScreen()

    await fireEvent(toggle, 'valueChange', true)
    expect(await view.findByLabelText('Hidden amount')).toBeOnTheScreen()
    expect(view.getByTestId('preferences-privacy-mode').props.value).toBe(true)

    await fireEvent(view.getByTestId('preferences-privacy-mode'), 'valueChange', false)
    expect(await view.findByLabelText('€42.00')).toBeOnTheScreen()
    expect(storage.saved).toEqual([true, false])
  })
})
