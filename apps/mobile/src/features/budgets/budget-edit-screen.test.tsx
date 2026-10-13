import { fireEvent, render, waitFor } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'
import { Alert } from 'react-native'

import { ApiError } from '@/lib/api/errors'
import { initMobileI18n } from '@/lib/i18n'

import { BudgetEditScreen, type BudgetEditModel } from './budget-edit-screen'
import { classifyBudgetWriteFailure } from './use-budget-metadata-mutation'

const model: BudgetEditModel = { id: 7, name: 'Household plan', description: 'Shared spending' }

const renderEditor = async (overrides: Partial<React.ComponentProps<typeof BudgetEditScreen>> = {}) => {
  const i18n = await initMobileI18n('en')
  const props: React.ComponentProps<typeof BudgetEditScreen> = { state: { status: 'loaded', model }, onBack: jest.fn(), onRetry: jest.fn(), onSaveMetadata: jest.fn().mockResolvedValue(undefined), pending: false, ...overrides }
  return { props, view: await render(<I18nextProvider i18n={i18n}><BudgetEditScreen {...props} /></I18nextProvider>) }
}

describe('budget metadata editor', () => {
  afterEach(() => jest.restoreAllMocks())

  it('uses exact API input limits and clears dirty state only after successful metadata save', async () => {
    const save = jest.fn().mockResolvedValue(undefined)
    const { view } = await renderEditor({ onSaveMetadata: save })
    expect(view.getByLabelText('Name').props.maxLength).toBe(100)
    expect(view.getByLabelText('Description').props.maxLength).toBe(500)
    await fireEvent.changeText(view.getByLabelText('Name'), ' Home plan ')
    await fireEvent.press(view.getByRole('button', { name: 'Save details' }))
    await waitFor(() => expect(save).toHaveBeenCalledWith({ name: ' Home plan ', description: 'Shared spending' }))
    await waitFor(() => expect(view.getByRole('button', { name: 'Save details' }).props.accessibilityState.disabled).toBe(true))
  })

  it('preserves input and explains ambiguous network failure without retrying it', async () => {
    const save = jest.fn().mockRejectedValue(new ApiError('network'))
    const { view } = await renderEditor({ onSaveMetadata: save })
    await fireEvent.changeText(view.getByLabelText('Description'), 'Still here')
    await fireEvent.press(view.getByRole('button', { name: 'Save details' }))
    expect(await view.findByRole('alert')).toHaveTextContent(/result is unknown.*not retry automatically/i)
    expect(view.getByLabelText('Description').props.value).toBe('Still here')
    expect(classifyBudgetWriteFailure(new ApiError('demo-forbidden'))).toBe('demo')
    expect(classifyBudgetWriteFailure(new ApiError('auth-session'))).toBe('access')
    expect(classifyBudgetWriteFailure(new ApiError('cancelled'))).toBe('cancelled')
    expect(classifyBudgetWriteFailure(new ApiError('http', 404))).toBe('not-found')
    expect(classifyBudgetWriteFailure(new ApiError('http', 500))).toBe('general')
  })

  it('guards dirty cancel/back and locks the whole metadata form while pending', async () => {
    const back = jest.fn()
    jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => { buttons?.[1]?.onPress?.() })
    const { view } = await renderEditor({ onBack: back })
    await fireEvent.changeText(view.getByLabelText('Name'), 'Unsaved')
    await fireEvent.press(view.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(back).toHaveBeenCalled())
    const pending = await renderEditor({ pending: true })
    expect(pending.view.getByLabelText('Name').props.editable).toBe(false)
    expect(pending.view.getByRole('button', { name: 'Cancel' }).props.accessibilityState.disabled).toBe(true)
  })

  it('shows stale authoritative metadata as an alert and no account controls', async () => {
    const { view } = await renderEditor({ state: { status: 'refresh-error', model } })
    expect(view.getByRole('alert')).toHaveTextContent(/previously loaded budget details/i)
    expect(view.queryByRole('checkbox')).not.toBeOnTheScreen()
    expect(view.queryByRole('button', { name: /account/i })).not.toBeOnTheScreen()
  })

  describe('delete budget', () => {
    it('does not offer deletion when no handler is provided', async () => {
      const { view } = await renderEditor()
      expect(view.queryByRole('button', { name: 'Delete budget' })).not.toBeOnTheScreen()
    })

    it('deletes only after explicit confirmation', async () => {
      const del = jest.fn().mockResolvedValue(undefined)
      jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => { buttons?.[1]?.onPress?.() })
      const { view } = await renderEditor({ onDeleteBudget: del })
      await fireEvent.press(view.getByRole('button', { name: 'Delete budget' }))
      await waitFor(() => expect(del).toHaveBeenCalledTimes(1))
    })

    it('does not delete when the confirmation is cancelled', async () => {
      const del = jest.fn().mockResolvedValue(undefined)
      jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => { buttons?.[0]?.onPress?.() })
      const { view } = await renderEditor({ onDeleteBudget: del })
      await fireEvent.press(view.getByRole('button', { name: 'Delete budget' }))
      expect(del).not.toHaveBeenCalled()
    })

    it('surfaces a scoped failure and keeps the form usable', async () => {
      const del = jest.fn().mockRejectedValue(new ApiError('http', 404))
      jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => { buttons?.[1]?.onPress?.() })
      const { view } = await renderEditor({ onDeleteBudget: del })
      await fireEvent.press(view.getByRole('button', { name: 'Delete budget' }))
      expect(await view.findByRole('alert')).toHaveTextContent(/no longer exists/i)
    })

    it('locks the whole form, including the danger action, while deletion is pending', async () => {
      const { view } = await renderEditor({ onDeleteBudget: jest.fn(), deletePending: true })
      expect(view.getByRole('button', { name: 'Deleting…' }).props.accessibilityState.disabled).toBe(true)
      expect(view.getByLabelText('Name').props.editable).toBe(false)
      expect(view.getByRole('button', { name: 'Cancel' }).props.accessibilityState.disabled).toBe(true)
    })
  })
})
