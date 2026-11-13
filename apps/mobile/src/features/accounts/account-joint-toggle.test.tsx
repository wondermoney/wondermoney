import { fireEvent, render, waitFor } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { attributionMark, householdMembersModel } from '@/features/household/member-attribution'
import { MemberBadge } from '@/features/household/member-badge'
import { initMobileI18n } from '@/lib/i18n'

import { AccountEditScreen, createAccountMetadataChanges, type AccountEditModel } from './account-edit-screen'

const owned: AccountEditModel = { id: 12, name: 'Everyday', isPrivate: false, isOwnedByViewer: true, isJoint: false }

async function renderEditor(model: AccountEditModel, multiMember: boolean) {
  const i18n = await initMobileI18n('en')
  const onSaveAccount = jest.fn().mockResolvedValue(undefined)
  const view = await render(
    <I18nextProvider i18n={i18n}>
      <AccountEditScreen
        creditCardPending={false}
        deletePending={false}
        multiMember={multiMember}
        onBack={jest.fn()}
        onDeleteAccount={jest.fn()}
        onRetry={jest.fn()}
        onSaveAccount={onSaveAccount}
        onSaveCreditCard={jest.fn()}
        pending={false}
        state={{ status: 'loaded', model }}
      />
    </I18nextProvider>,
  )
  return { view, onSaveAccount }
}

describe('joint account switch', () => {
  it('lets the owner of an account in a household of more than one mark it joint', async () => {
    const { view, onSaveAccount } = await renderEditor(owned, true)
    await fireEvent(view.getByTestId('account-joint-switch'), 'valueChange', true)
    await fireEvent.press(view.getByRole('button', { name: 'Save details' }))
    await waitFor(() => expect(onSaveAccount).toHaveBeenCalledWith({ isJoint: true }))
  })

  it('is not offered to anyone but the owner, in a household of one, or by an API that does not report it', async () => {
    for (const [model, multiMember] of [
      [{ ...owned, isOwnedByViewer: false }, true],
      [owned, false],
      [{ id: 12, name: 'Everyday', isPrivate: false, isOwnedByViewer: true }, true],
    ] as const) {
      const { view } = await renderEditor(model, multiMember)
      expect(view.queryByTestId('account-joint-switch')).toBeNull()
      await view.unmount()
    }
  })

  it('never sends isJoint for an account the viewer does not own', () => {
    expect(createAccountMetadataChanges({ ...owned, isOwnedByViewer: false }, { name: 'Everyday', isPrivate: false, isJoint: true })).toBeNull()
    expect(createAccountMetadataChanges(owned, { name: 'Everyday', isPrivate: false, isJoint: true })).toEqual({ isJoint: true })
  })
})

describe('account member badge', () => {
  const two = householdMembersModel({
    members: [
      { appuserKey: 11, emailAddress: 'ana@example.test', firstName: 'Ana', role: 'owner' },
      { appuserKey: 12, emailAddress: 'bruno@example.test', firstName: 'Bruno', role: 'member' },
    ],
    maxMembers: 6,
    pendingInvites: [],
    viewerAppuserKey: 11,
  })

  it('shows the owner\'s initial, or Shared for a joint account', async () => {
    const i18n = await initMobileI18n('en')
    const member = await render(<I18nextProvider i18n={i18n}><MemberBadge mark={attributionMark({ appuserKey: 12, displayName: 'Bruno' }, two)} /></I18nextProvider>)
    expect(member.getByText('B')).toBeOnTheScreen()
    expect(member.getByLabelText('Attributed to Bruno')).toBeOnTheScreen()
    const shared = await render(<I18nextProvider i18n={i18n}><MemberBadge mark={attributionMark({ appuserKey: null, displayName: null }, two)} /></I18nextProvider>)
    expect(shared.getByText('Shared')).toBeOnTheScreen()
  })
})
