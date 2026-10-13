import { fireEvent, render } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { initMobileI18n } from '@/lib/i18n'

import { ProfileEditScreen } from './profile-edit-screen'

async function renderScreen(overrides: Partial<React.ComponentProps<typeof ProfileEditScreen>> = {}) {
  const i18n = await initMobileI18n('en')
  const props = {
    initialFirstName: 'Ada',
    initialLastName: 'Lovelace',
    pending: false,
    failure: null,
    onCancel: jest.fn(),
    onSubmit: jest.fn(),
    ...overrides,
  }
  const view = await render(<I18nextProvider i18n={i18n}><ProfileEditScreen {...props} /></I18nextProvider>)
  return { view, props }
}

describe('ProfileEditScreen', () => {
  it('prefills the current name and submits only the trimmed, non-empty fields', async () => {
    const onSubmit = jest.fn()
    const { view } = await renderScreen({ onSubmit })
    expect(view.getByLabelText('First name').props.value).toBe('Ada')
    await fireEvent.changeText(view.getByLabelText('First name'), '  Grace  ')
    await fireEvent.changeText(view.getByLabelText('Last name'), '   ')
    await fireEvent.press(view.getByRole('button', { name: 'Save changes' }))
    expect(onSubmit).toHaveBeenCalledWith({ firstName: 'Grace' })
  })

  it('requires at least one name and does not submit an empty change', async () => {
    const onSubmit = jest.fn()
    const { view } = await renderScreen({ initialFirstName: '', initialLastName: '', onSubmit })
    await fireEvent.press(view.getByRole('button', { name: 'Save changes' }))
    expect(onSubmit).not.toHaveBeenCalled()
    expect(view.getByRole('alert')).toBeOnTheScreen()
    expect(view.getByText('Enter a first or last name to save.')).toBeOnTheScreen()
  })

  it('disables inputs and the save action while pending', async () => {
    const onSubmit = jest.fn()
    const { view } = await renderScreen({ pending: true, onSubmit })
    const save = view.getByRole('button', { name: 'Saving…' })
    expect(save.props.accessibilityState.disabled).toBe(true)
    await fireEvent.press(save)
    expect(onSubmit).not.toHaveBeenCalled()
    expect(view.getByLabelText('First name').props.editable).toBe(false)
  })

  it('surfaces a specific, non-destructive failure', async () => {
    const { view } = await renderScreen({ failure: 'unknown' })
    expect(view.getByRole('alert')).toBeOnTheScreen()
    expect(view.getByText(/could not be confirmed/i)).toBeOnTheScreen()
  })
})
