import { fireEvent, render } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { Amount } from '@/components/ui/amount'
import { initMobileI18n } from '@/lib/i18n'
import { memoryPreferenceStorage, PrivacyModeProvider } from '@/test/privacy-mode'

import { PreferencesScreen } from './preferences-screen'

jest.mock('expo-router', () => ({ useRouter: () => ({ back: jest.fn() }) }))
jest.mock('./preview-features-section', () => ({ PreviewFeaturesSection: () => null }))
jest.mock('./ai-hidden-section', () => ({ AiHiddenSection: () => null }))

const mockWrite = jest.fn(() => Promise.resolve(undefined))
let mockRuntime: { apiClient: { write: typeof mockWrite }; principalId: string } | null = null
jest.mock('@/components/providers/product-runtime-provider', () => ({
  useOptionalProductRuntime: () => (mockRuntime ? { runtime: mockRuntime } : null),
}))

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

describe('PreferencesScreen: language', () => {
  beforeEach(() => {
    mockWrite.mockClear()
    mockRuntime = { apiClient: { write: mockWrite }, principalId: 'user-1' }
  })

  afterEach(() => {
    mockRuntime = null
  })

  it('sets the account language to Spanish when the person picks Español, so emails follow', async () => {
    const i18n = await initMobileI18n('en')
    const view = await render(
      <I18nextProvider i18n={i18n}>
        <PrivacyModeProvider storage={memoryPreferenceStorage(false)}>
          <PreferencesScreen />
        </PrivacyModeProvider>
      </I18nextProvider>,
    )

    await fireEvent.press(view.getByTestId('preferences-language'))
    await fireEvent.press(view.getByText('Español'))

    expect(mockWrite).toHaveBeenCalledTimes(1)
    expect(mockWrite).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'PATCH', path: '/v1/user/user-1' }),
      expect.objectContaining({ body: { language: 'ES' } }),
    )
  })
})
