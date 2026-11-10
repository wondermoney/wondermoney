import { fireEvent, render } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { initMobileI18n } from '@/lib/i18n'

import { PreviewFeaturesSection } from './preview-features-section'

const mockSetEnabled = jest.fn()
const mockState = {
  enabled: false,
  isLoading: false,
  isLoadError: false,
  isSaving: false,
  saveError: false,
  setEnabled: mockSetEnabled,
}
jest.mock('./use-preview-features', () => ({
  usePreviewFeatures: () => mockState,
}))

async function renderSection() {
  const i18n = await initMobileI18n('en')
  return render(
    <I18nextProvider i18n={i18n}>
      <PreviewFeaturesSection />
    </I18nextProvider>,
  )
}

describe('PreviewFeaturesSection', () => {
  beforeEach(() => {
    mockSetEnabled.mockClear()
    Object.assign(mockState, {
      enabled: false,
      isLoading: false,
      isLoadError: false,
      isSaving: false,
      saveError: false,
    })
  })

  it('shows the stored choice and turns preview features on', async () => {
    const view = await renderSection()

    const toggle = view.getByTestId('preferences-preview-features')
    expect(toggle.props.value).toBe(false)
    expect(view.getByText(/unfinished/u)).toBeOnTheScreen()

    await fireEvent(toggle, 'valueChange', true)

    expect(mockSetEnabled).toHaveBeenCalledWith(true)
  })

  it('turns preview features off again', async () => {
    mockState.enabled = true
    const view = await renderSection()

    await fireEvent(view.getByTestId('preferences-preview-features'), 'valueChange', false)

    expect(mockSetEnabled).toHaveBeenCalledWith(false)
  })

  it('disables the switch and explains a failed load', async () => {
    mockState.isLoadError = true
    const view = await renderSection()

    expect(view.getByText('Could not load your preferences.')).toBeOnTheScreen()
    expect(view.getByTestId('preferences-preview-features').props.disabled).toBe(true)
  })

  it('reports a failed save without hiding the switch', async () => {
    mockState.saveError = true
    const view = await renderSection()

    expect(view.getByText('Could not save. Try again.')).toBeOnTheScreen()
    expect(view.getByTestId('preferences-preview-features').props.disabled).toBe(false)
  })
})
