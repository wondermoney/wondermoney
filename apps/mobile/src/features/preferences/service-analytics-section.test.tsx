import { fireEvent, render } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { initMobileI18n } from '@/lib/i18n'

import { ServiceAnalyticsSection } from './service-analytics-section'

const mockSetEnabled = jest.fn()
const mockState = { available: true, enabled: true, isSaving: false, saveError: false, setEnabled: mockSetEnabled }
jest.mock('./use-service-analytics', () => ({
  useServiceAnalytics: () => mockState,
}))

async function renderSection() {
  const i18n = await initMobileI18n('en')
  return render(
    <I18nextProvider i18n={i18n}>
      <ServiceAnalyticsSection />
    </I18nextProvider>,
  )
}

describe('ServiceAnalyticsSection', () => {
  beforeEach(() => {
    mockSetEnabled.mockClear()
    Object.assign(mockState, { available: true, enabled: true, isSaving: false, saveError: false })
  })

  it('shows service analytics on and lets the person object', async () => {
    const view = await renderSection()

    const toggle = view.getByTestId('preferences-service-analytics')
    expect(toggle.props.value).toBe(true)
    await fireEvent(toggle, 'valueChange', false)

    expect(mockSetEnabled).toHaveBeenCalledWith(false)
  })

  it('lets a person who objected allow them again', async () => {
    mockState.enabled = false
    const view = await renderSection()

    await fireEvent(view.getByTestId('preferences-service-analytics'), 'valueChange', true)

    expect(mockSetEnabled).toHaveBeenCalledWith(true)
  })

  it('shows nothing on a server that records no service analytics', async () => {
    mockState.available = false
    const view = await renderSection()

    expect(view.queryByTestId('preferences-service-analytics')).toBeNull()
  })
})
