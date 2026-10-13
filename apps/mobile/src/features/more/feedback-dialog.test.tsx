import { fireEvent, render, waitFor } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { initMobileI18n } from '@/lib/i18n'

import { FeedbackDialog } from './feedback-dialog'

async function renderDialog(overrides: Partial<React.ComponentProps<typeof FeedbackDialog>> = {}) {
  const i18n = await initMobileI18n('en')
  const props: React.ComponentProps<typeof FeedbackDialog> = {
    visible: true,
    pending: false,
    failed: false,
    onCancel: jest.fn(),
    onSubmit: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  }
  const view = await render(
    <I18nextProvider i18n={i18n}>
      <FeedbackDialog {...props} />
    </I18nextProvider>,
  )
  return { view, props }
}

describe('FeedbackDialog', () => {
  it('renders nothing when not visible', async () => {
    const { view } = await renderDialog({ visible: false })
    expect(view.toJSON()).toBeNull()
  })

  it('shows the three feedback categories as radio options', async () => {
    const { view } = await renderDialog()
    expect(view.getByRole('radio', { name: 'Bug' })).toBeOnTheScreen()
    expect(view.getByRole('radio', { name: 'Feature request' })).toBeOnTheScreen()
    expect(view.getByRole('radio', { name: 'Other' })).toBeOnTheScreen()
  })

  it('requires a category before submitting', async () => {
    const onSubmit = jest.fn()
    const { view } = await renderDialog({ onSubmit })
    await fireEvent.changeText(view.getByLabelText('Your feedback'), 'Something is broken')
    await fireEvent.press(view.getByRole('button', { name: 'Send feedback' }))
    await waitFor(() => expect(view.getByText('Choose a category')).toBeOnTheScreen())
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('requires a message before submitting', async () => {
    const onSubmit = jest.fn()
    const { view } = await renderDialog({ onSubmit })
    await fireEvent.press(view.getByRole('radio', { name: 'Bug' }))
    await fireEvent.press(view.getByRole('button', { name: 'Send feedback' }))
    await waitFor(() => expect(view.getByText('Enter a message')).toBeOnTheScreen())
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('submits the selected category and message', async () => {
    const onSubmit = jest.fn().mockResolvedValue(undefined)
    const { view } = await renderDialog({ onSubmit })
    await fireEvent.press(view.getByRole('radio', { name: 'Feature request' }))
    await fireEvent.changeText(view.getByLabelText('Your feedback'), 'Add dark mode charts')
    await fireEvent.press(view.getByRole('button', { name: 'Send feedback' }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ category: 'feature_request', message: 'Add dark mode charts' }))
  })

  it('marks the selected category as checked', async () => {
    const { view } = await renderDialog()
    await fireEvent.press(view.getByRole('radio', { name: 'Other' }))
    expect(view.getByRole('radio', { name: 'Other' }).props.accessibilityState).toEqual(
      expect.objectContaining({ checked: true }),
    )
    expect(view.getByRole('radio', { name: 'Bug' }).props.accessibilityState).toEqual(
      expect.objectContaining({ checked: false }),
    )
  })

  it('shows a submit failure without losing the entered message', async () => {
    const { view } = await renderDialog({ failed: true })
    expect(view.getByRole('alert', { name: 'Could not open your mail app to send this. Try again.' })).toBeOnTheScreen()
  })

  it('disables all controls while pending', async () => {
    const { view } = await renderDialog({ pending: true })
    expect(view.getByLabelText('Your feedback').props.editable).toBe(false)
    expect(view.getByRole('button', { name: 'Sending…' }).props.accessibilityState.disabled).toBe(true)
    expect(view.getByRole('button', { name: 'Cancel' }).props.accessibilityState.disabled).toBe(true)
  })

  it('invokes onCancel', async () => {
    const onCancel = jest.fn()
    const { view } = await renderDialog({ onCancel })
    await fireEvent.press(view.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
