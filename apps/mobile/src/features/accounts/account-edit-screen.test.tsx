import { fireEvent, render, waitFor } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'
import { Alert } from 'react-native'

import { ApiError } from '@/lib/api/errors'
import { initMobileI18n } from '@/lib/i18n'

import { AccountEditScreen, createAccountMetadataChanges, type AccountEditModel } from './account-edit-screen'
import { classifyAccountWriteFailure } from './use-account-metadata-mutation'

const ownedModel: AccountEditModel = { id: 12, name: 'Everyday', isPrivate: false, isOwnedByViewer: true }
const sharedModel: AccountEditModel = { id: 13, name: 'Joint savings', isPrivate: false, isOwnedByViewer: false }

const renderEditor = async (overrides: Partial<React.ComponentProps<typeof AccountEditScreen>> = {}) => {
  const i18n = await initMobileI18n('en')
  const props: React.ComponentProps<typeof AccountEditScreen> = {
    state: { status: 'loaded', model: ownedModel },
    onBack: jest.fn(),
    onRetry: jest.fn(),
    onSaveAccount: jest.fn().mockResolvedValue(undefined),
    onDeleteAccount: jest.fn().mockResolvedValue(undefined),
    pending: false,
    deletePending: false,
    ...overrides,
  }
  return { props, view: await render(<I18nextProvider i18n={i18n}><AccountEditScreen {...props} /></I18nextProvider>) }
}

describe('account metadata editor', () => {
  afterEach(() => jest.restoreAllMocks())

  it('uses the exact API name limit and clears dirty state only after successful save', async () => {
    const save = jest.fn().mockResolvedValue(undefined)
    const { view } = await renderEditor({ onSaveAccount: save })
    expect(view.getByLabelText('Name').props.maxLength).toBe(100)
    await fireEvent.changeText(view.getByLabelText('Name'), 'Main account')
    await fireEvent.press(view.getByRole('button', { name: 'Save details' }))
    await waitFor(() => expect(save).toHaveBeenCalledWith({ accountName: 'Main account' }))
    await waitFor(() => expect(view.getByRole('button', { name: 'Save details' }).props.accessibilityState.disabled).toBe(true))
  })

  it('shows the owner-only privacy switch and saves it alongside the name', async () => {
    const save = jest.fn().mockResolvedValue(undefined)
    const { view } = await renderEditor({ onSaveAccount: save })
    const toggle = view.getByRole('switch', { name: 'Private account' })
    expect(toggle.props.accessibilityState.checked).toBe(false)
    await fireEvent(toggle, 'valueChange', true)
    await fireEvent.press(view.getByRole('button', { name: 'Save details' }))
    await waitFor(() => expect(save).toHaveBeenCalledWith({ isPrivate: true }))
  })

  it('hides the privacy switch entirely for a non-owned shared account', async () => {
    const { view } = await renderEditor({ state: { status: 'loaded', model: sharedModel } })
    expect(view.queryByRole('switch')).not.toBeOnTheScreen()
  })

  it('preserves input and explains ambiguous network failure without retrying it', async () => {
    const save = jest.fn().mockRejectedValue(new ApiError('network'))
    const { view } = await renderEditor({ onSaveAccount: save })
    await fireEvent.changeText(view.getByLabelText('Name'), 'Still here')
    await fireEvent.press(view.getByRole('button', { name: 'Save details' }))
    expect(await view.findByRole('alert')).toHaveTextContent(/result is unknown.*not retry automatically/i)
    expect(view.getByLabelText('Name').props.value).toBe('Still here')
    expect(classifyAccountWriteFailure(new ApiError('demo-forbidden'))).toBe('demo')
    expect(classifyAccountWriteFailure(new ApiError('auth-session'))).toBe('access')
    expect(classifyAccountWriteFailure(new ApiError('cancelled'))).toBe('cancelled')
    expect(classifyAccountWriteFailure(new ApiError('http', 404))).toBe('not-found')
    expect(classifyAccountWriteFailure(new ApiError('http', 500))).toBe('general')
  })

  it('guards dirty cancel/back and locks the whole form while pending', async () => {
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

  it('shows stale authoritative details as an alert', async () => {
    const { view } = await renderEditor({ state: { status: 'refresh-error', model: ownedModel } })
    expect(view.getByRole('alert')).toHaveTextContent(/previously loaded account details/i)
  })

  it.each([
    ['invalid-id', { status: 'invalid-id' as const }],
    ['not-found', { status: 'not-found' as const }],
    ['invalid-response', { status: 'invalid-response' as const }],
    ['error', { status: 'error' as const }],
  ])('renders a distinct failure state for %s', async (_label, state) => {
    const { view } = await renderEditor({ state })
    expect(view.getByRole('header')).toBeOnTheScreen()
  })

  it('renders nothing during an access transition', async () => {
    const { view } = await renderEditor({ state: { status: 'access-transition' } })
    expect(view.toJSON()).toBeNull()
  })

  describe('delete account', () => {
    it('deletes only after explicit confirmation', async () => {
      const del = jest.fn().mockResolvedValue(undefined)
      jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => { buttons?.[1]?.onPress?.() })
      const { view } = await renderEditor({ onDeleteAccount: del })
      await fireEvent.press(view.getByRole('button', { name: 'Delete account' }))
      await waitFor(() => expect(del).toHaveBeenCalledTimes(1))
    })

    it('does not delete when the confirmation is cancelled', async () => {
      const del = jest.fn().mockResolvedValue(undefined)
      jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => { buttons?.[0]?.onPress?.() })
      const { view } = await renderEditor({ onDeleteAccount: del })
      await fireEvent.press(view.getByRole('button', { name: 'Delete account' }))
      expect(del).not.toHaveBeenCalled()
    })

    it('surfaces a scoped failure and keeps the form usable', async () => {
      const del = jest.fn().mockRejectedValue(new ApiError('http', 404))
      jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => { buttons?.[1]?.onPress?.() })
      const { view } = await renderEditor({ onDeleteAccount: del })
      await fireEvent.press(view.getByRole('button', { name: 'Delete account' }))
      expect(await view.findByRole('alert')).toHaveTextContent(/no longer exists/i)
    })

    it('locks the whole form, including the danger action, while deletion is pending', async () => {
      const { view } = await renderEditor({ deletePending: true })
      expect(view.getByRole('button', { name: 'Deleting…' }).props.accessibilityState.disabled).toBe(true)
      expect(view.getByLabelText('Name').props.editable).toBe(false)
      expect(view.getByRole('button', { name: 'Cancel' }).props.accessibilityState.disabled).toBe(true)
    })
  })
})

describe('createAccountMetadataChanges', () => {
  it('diffs only the name for an unowned shared account, ignoring privacy drift', () => {
    expect(createAccountMetadataChanges(sharedModel, { name: 'Joint savings', isPrivate: true })).toBeNull()
    expect(createAccountMetadataChanges(sharedModel, { name: 'Renamed', isPrivate: true })).toEqual({ accountName: 'Renamed' })
  })

  it('diffs both fields for an owned account', () => {
    expect(createAccountMetadataChanges(ownedModel, { name: 'Everyday', isPrivate: false })).toBeNull()
    expect(createAccountMetadataChanges(ownedModel, { name: 'Everyday', isPrivate: true })).toEqual({ isPrivate: true })
    expect(createAccountMetadataChanges(ownedModel, { name: 'Renamed', isPrivate: true })).toEqual({ accountName: 'Renamed', isPrivate: true })
  })
})
