import { fireEvent, render, waitFor } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'
import { Alert } from 'react-native'

import { ApiError } from '@/lib/api/errors'
import { initMobileI18n } from '@/lib/i18n'

import { AccountEditScreen, createAccountMetadataChanges, createCreditCardChanges, type AccountEditModel } from './account-edit-screen'
import type { AccountSharesDto } from './account-sharing-contract'
import { classifyAccountWriteFailure } from './use-account-metadata-mutation'

const ownedModel: AccountEditModel = { id: 12, name: 'Everyday', isPrivate: false, isOwnedByViewer: true }
const sharedModel: AccountEditModel = { id: 13, name: 'Joint savings', isPrivate: false, isOwnedByViewer: false }

const ana = { appuserKey: 3, firstName: 'Ana', lastName: 'Silva', role: 'owner', isAccountOwner: true, share: null, access: 'owner' } as const
const rui = { appuserKey: 4, firstName: 'Rui', lastName: null, role: 'member', isAccountOwner: false, share: null, access: 'write' } as const
const eva = { appuserKey: 5, firstName: 'Eva', lastName: null, role: 'viewer', isAccountOwner: false, share: null, access: 'read' } as const
const shares: AccountSharesDto = { accountKey: 12, isPrivate: false, canManage: true, members: [ana, rui, eva] }
const loadedSharing = (value: Partial<AccountSharesDto> = {}) => ({ status: 'loaded' as const, shares: { ...shares, ...value } })

const renderEditor = async (overrides: Partial<React.ComponentProps<typeof AccountEditScreen>> = {}) => {
  const i18n = await initMobileI18n('en')
  const props: React.ComponentProps<typeof AccountEditScreen> = {
    state: { status: 'loaded', model: ownedModel },
    onBack: jest.fn(),
    onRetry: jest.fn(),
    onSaveAccount: jest.fn().mockResolvedValue(undefined),
    onSaveCreditCard: jest.fn().mockResolvedValue(undefined),
    onDeleteAccount: jest.fn().mockResolvedValue(undefined),
    pending: false,
    creditCardPending: false,
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

  it('on an API from before per-member sharing, shows the owner-only privacy switch and saves it alongside the name', async () => {
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
    expect(view.queryByRole('switch', { name: 'Private account' })).not.toBeOnTheScreen()
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
    await fireEvent.press(view.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(back).toHaveBeenCalled())
    const pending = await renderEditor({ pending: true })
    expect(pending.view.getByLabelText('Name').props.editable).toBe(false)
    expect(pending.view.getByRole('button', { name: 'Close' }).props.accessibilityState.disabled).toBe(true)
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
      expect(view.getByRole('button', { name: 'Close' }).props.accessibilityState.disabled).toBe(true)
    })
  })
})

describe('per-member sharing', () => {
  afterEach(() => jest.restoreAllMocks())

  it('lists the account owner as Owner and each other member with their access, in place of the private switch', async () => {
    const { view } = await renderEditor({ sharing: loadedSharing() })
    expect(view.queryByRole('switch', { name: 'Private account' })).not.toBeOnTheScreen()
    expect(view.getByLabelText('Ana Silva, Owner')).toBeOnTheScreen()
    expect(view.getByRole('button', { name: 'Access for Rui, Can edit' })).toBeOnTheScreen()
    expect(view.getByRole('button', { name: 'Access for Eva, Can view' })).toBeOnTheScreen()
    expect(view.getByText('Viewers can only view, never edit.')).toBeOnTheScreen()
    expect(view.getByTestId('account-sharing-later')).toHaveTextContent(/join the household later can see and edit it/i)
    expect(view.getByRole('button', { name: 'Save details' }).props.accessibilityState.disabled).toBe(true)
  })

  it('offers a viewer only Hidden and Can view, and a member all three', async () => {
    const { view } = await renderEditor({ sharing: loadedSharing(), onSaveSharing: jest.fn() })
    await fireEvent.press(view.getByRole('button', { name: 'Access for Eva, Can view' }))
    expect(view.getAllByRole('radio').map((option) => option.props.accessibilityLabel)).toEqual(['Hidden', 'Can view'])
    await fireEvent.press(view.getByRole('radio', { name: 'Hidden' }))
    await fireEvent.press(view.getByRole('button', { name: 'Access for Rui, Can edit' }))
    expect(view.getAllByRole('radio').map((option) => option.props.accessibilityLabel)).toEqual(['Hidden', 'Can view', 'Can edit'])
  })

  it('saves a mixed choice as private with the members who can view or edit, and never through the PATCH', async () => {
    const saveSharing = jest.fn().mockResolvedValue(undefined)
    const save = jest.fn().mockResolvedValue(undefined)
    const { view } = await renderEditor({ sharing: loadedSharing(), onSaveSharing: saveSharing, onSaveAccount: save })
    await fireEvent.press(view.getByRole('button', { name: 'Access for Rui, Can edit' }))
    await fireEvent.press(view.getByRole('radio', { name: 'Can view' }))
    await fireEvent.press(view.getByRole('button', { name: 'Access for Eva, Can view' }))
    await fireEvent.press(view.getByRole('radio', { name: 'Hidden' }))
    expect(view.getByTestId('account-sharing-later')).toHaveTextContent(/won't see it until someone shares it/i)
    await fireEvent.press(view.getByRole('button', { name: 'Save details' }))
    await waitFor(() => expect(saveSharing).toHaveBeenCalledWith({ isPrivate: true, shares: [{ appuserKey: 4, access: 'read' }] }))
    expect(save).not.toHaveBeenCalled()
  })

  it('saves everyone back at their most as shared with the household', async () => {
    const saveSharing = jest.fn().mockResolvedValue(undefined)
    const sharing = loadedSharing({ isPrivate: true, members: [ana, { ...rui, share: 'read', access: 'read' }, { ...eva, access: 'hidden' }] })
    const { view } = await renderEditor({ sharing, onSaveSharing: saveSharing })
    await fireEvent.press(view.getByRole('button', { name: 'Access for Rui, Can view' }))
    await fireEvent.press(view.getByRole('radio', { name: 'Can edit' }))
    await fireEvent.press(view.getByRole('button', { name: 'Access for Eva, Hidden' }))
    await fireEvent.press(view.getByRole('radio', { name: 'Can view' }))
    await fireEvent.press(view.getByRole('button', { name: 'Save details' }))
    await waitFor(() => expect(saveSharing).toHaveBeenCalledWith({ isPrivate: false, shares: [] }))
  })

  it('is not dirty when a choice goes back to where it started', async () => {
    const { view } = await renderEditor({ sharing: loadedSharing(), onSaveSharing: jest.fn() })
    await fireEvent.press(view.getByRole('button', { name: 'Access for Rui, Can edit' }))
    await fireEvent.press(view.getByRole('radio', { name: 'Hidden' }))
    expect(view.getByRole('button', { name: 'Save details' }).props.accessibilityState.disabled).toBe(false)
    await fireEvent.press(view.getByRole('button', { name: 'Access for Rui, Hidden' }))
    await fireEvent.press(view.getByRole('radio', { name: 'Can edit' }))
    expect(view.getByRole('button', { name: 'Save details' }).props.accessibilityState.disabled).toBe(true)
  })

  it('shows the list read-only to someone who cannot change it', async () => {
    const { view } = await renderEditor({ state: { status: 'loaded', model: sharedModel }, sharing: loadedSharing({ canManage: false }), onSaveSharing: jest.fn() })
    expect(view.queryByRole('button', { name: /^Access for/ })).not.toBeOnTheScreen()
    expect(view.getByLabelText('Rui, Can edit')).toBeOnTheScreen()
    expect(view.getByLabelText('Eva, Can view')).toBeOnTheScreen()
    expect(view.getByText(/Only the account's owner or the household owner can change/)).toBeOnTheScreen()
  })

  it('keeps a plain private switch when nobody else is in the household, and saves it with no shares', async () => {
    const saveSharing = jest.fn().mockResolvedValue(undefined)
    const { view } = await renderEditor({ sharing: loadedSharing({ members: [ana] }), onSaveSharing: saveSharing })
    expect(view.getByText(/nobody else in your household to share it with yet/i)).toBeOnTheScreen()
    await fireEvent(view.getByRole('switch', { name: 'Private account' }), 'valueChange', true)
    await fireEvent.press(view.getByRole('button', { name: 'Save details' }))
    await waitFor(() => expect(saveSharing).toHaveBeenCalledWith({ isPrivate: true, shares: [] }))
  })

  it('words a refusal to change sharing', async () => {
    const saveSharing = jest.fn().mockRejectedValue(new ApiError('account-share-manager-required', 403))
    const { view } = await renderEditor({ sharing: loadedSharing(), onSaveSharing: saveSharing })
    await fireEvent.press(view.getByRole('button', { name: 'Access for Rui, Can edit' }))
    await fireEvent.press(view.getByRole('radio', { name: 'Hidden' }))
    await fireEvent.press(view.getByRole('button', { name: 'Save details' }))
    expect(await view.findByRole('alert')).toHaveTextContent(/Only the account's owner or the household owner can change who it's shared with/)
  })

  it('keeps the rest of the form usable while the sharing loads or fails', async () => {
    const retry = jest.fn()
    const loading = await renderEditor({ sharing: { status: 'loading' } })
    expect(loading.view.getByText('Loading who can see this account…')).toBeOnTheScreen()
    expect(loading.view.getByLabelText('Name').props.editable).toBe(true)
    const failed = await renderEditor({ sharing: { status: 'error' }, onRetrySharing: retry })
    await fireEvent.press(failed.view.getByRole('button', { name: 'Retry' }))
    expect(retry).toHaveBeenCalled()
  })

  it('on an account the caller can only view, shows its sharing and nothing to change', async () => {
    const { view } = await renderEditor({ state: { status: 'loaded', model: { ...sharedModel, myAccess: 'read' } }, sharing: loadedSharing({ canManage: false }) })
    expect(view.getByText('You can view this account but not change it.')).toBeOnTheScreen()
    expect(view.queryByLabelText('Name')).not.toBeOnTheScreen()
    expect(view.queryByRole('switch', { name: 'Credit card account' })).not.toBeOnTheScreen()
    expect(view.queryByRole('button', { name: 'Delete account' })).not.toBeOnTheScreen()
    expect(view.queryByRole('button', { name: 'Save details' })).not.toBeOnTheScreen()
    expect(view.getByLabelText('Rui, Can edit')).toBeOnTheScreen()
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

describe('createCreditCardChanges', () => {
  const form = (overrides: Partial<Parameters<typeof createCreditCardChanges>[1]> = {}) => ({
    enabled: true,
    statementCloseDay: '31',
    paymentDueDay: '10',
    creditLimit: '1000',
    minimumPaymentPercent: '',
    ...overrides,
  })

  it('sends the cycle when an account is being marked as a card', () => {
    expect(createCreditCardChanges(null, form())).toEqual({
      statementCloseDay: 31,
      paymentDueDay: 10,
      creditLimit: 1000,
      minimumPaymentPercent: null,
    })
  })

  it('sends nothing when the cycle is unchanged', () => {
    const original = { statementCloseDay: 31, paymentDueDay: 10, creditLimit: 1000, minimumPaymentPercent: null }
    expect(createCreditCardChanges(original, form())).toBeNull()
  })

  it('sends only when a day or the limit moves', () => {
    const original = { statementCloseDay: 31, paymentDueDay: 10, creditLimit: 1000, minimumPaymentPercent: null }
    expect(createCreditCardChanges(original, form({ statementCloseDay: '28' }))).toMatchObject({ statementCloseDay: 28 })
    expect(createCreditCardChanges(original, form({ creditLimit: '' }))).toMatchObject({ creditLimit: null })
  })

  it('sends nothing when the switch is off', () => {
    expect(createCreditCardChanges(null, form({ enabled: false }))).toBeNull()
  })
})

describe('credit card settings in the editor', () => {
  it('reveals the cycle fields once the card switch is on', async () => {
    const { view } = await renderEditor()
    const toggle = view.getByRole('switch', { name: 'Credit card account' })
    expect(toggle.props.accessibilityState.checked).toBe(false)
    expect(view.queryByLabelText('Statement closes on (1–31)')).not.toBeOnTheScreen()
    await fireEvent(toggle, 'valueChange', true)
    expect(view.getByLabelText('Statement closes on (1–31)')).toBeOnTheScreen()
    expect(view.getByLabelText('Payment due on (1–31)')).toBeOnTheScreen()
    expect(view.getByLabelText('Credit limit')).toBeOnTheScreen()
  })

  it('saves the card settings before the account metadata', async () => {
    const saveCard = jest.fn().mockResolvedValue(undefined)
    const save = jest.fn().mockResolvedValue(undefined)
    const { view } = await renderEditor({ onSaveCreditCard: saveCard, onSaveAccount: save })
    await fireEvent(view.getByRole('switch', { name: 'Credit card account' }), 'valueChange', true)
    await fireEvent.changeText(view.getByLabelText('Statement closes on (1–31)'), '31')
    await fireEvent.changeText(view.getByLabelText('Payment due on (1–31)'), '10')
    await fireEvent.press(view.getByRole('button', { name: 'Save details' }))
    await waitFor(() => expect(saveCard).toHaveBeenCalledWith({ statementCloseDay: 31, paymentDueDay: 10, creditLimit: null, minimumPaymentPercent: null }))
    expect(save).not.toHaveBeenCalled()
  })

  it('locks the card toggle once the account is a card', async () => {
    const { view } = await renderEditor({ state: { status: 'loaded', model: { ...ownedModel, creditCard: { statementCloseDay: 25, paymentDueDay: 10, creditLimit: 1500, minimumPaymentPercent: null } } } })
    const toggle = view.getByRole('switch', { name: 'Credit card account' })
    expect(toggle.props.accessibilityState.checked).toBe(true)
    expect(toggle.props.accessibilityState.disabled).toBe(true)
    expect(view.getByLabelText('Statement closes on (1–31)').props.value).toBe('25')
  })
})
