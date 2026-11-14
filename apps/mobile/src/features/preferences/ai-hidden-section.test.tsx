import { fireEvent, render } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { initMobileI18n } from '@/lib/i18n'

import { AiHiddenSection } from './ai-hidden-section'

const mockSetHidden = jest.fn()
const mockState = {
  hidden: false,
  isLoading: false,
  isLoadError: false,
  isSaving: false,
  saveError: false,
  setHidden: mockSetHidden,
}
jest.mock('./use-ai-hidden', () => ({
  useAiHidden: () => mockState,
}))

async function renderSection() {
  const i18n = await initMobileI18n('en')
  return render(
    <I18nextProvider i18n={i18n}>
      <AiHiddenSection />
    </I18nextProvider>,
  )
}

describe('AiHiddenSection', () => {
  beforeEach(() => {
    mockSetHidden.mockClear()
    Object.assign(mockState, {
      hidden: false,
      isLoading: false,
      isLoadError: false,
      isSaving: false,
      saveError: false,
    })
  })

  it('shows the stored choice and hides AI features', async () => {
    const view = await renderSection()

    const toggle = view.getByTestId('preferences-ai-hidden')
    expect(toggle.props.value).toBe(false)
    expect(view.getByText(/assistant, receipt scanning/u)).toBeOnTheScreen()

    await fireEvent(toggle, 'valueChange', true)

    expect(mockSetHidden).toHaveBeenCalledWith(true)
  })

  it('turns AI features back on', async () => {
    mockState.hidden = true
    const view = await renderSection()

    await fireEvent(view.getByTestId('preferences-ai-hidden'), 'valueChange', false)

    expect(mockSetHidden).toHaveBeenCalledWith(false)
  })

  it('disables the switch and explains a failed load', async () => {
    mockState.isLoadError = true
    const view = await renderSection()

    expect(view.getByText('Could not load your preferences.')).toBeOnTheScreen()
    expect(view.getByTestId('preferences-ai-hidden').props.disabled).toBe(true)
  })
})
