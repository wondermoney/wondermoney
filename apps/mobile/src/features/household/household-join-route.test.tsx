import { fireEvent, render, waitFor } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { ApiError } from '@/lib/api/errors'
import { initMobileI18n } from '@/lib/i18n'
import { setJoinInviteToken, takeJoinInviteToken } from '@/lib/auth/join-invite-token-store'

import { HouseholdJoinRoute } from './household-join-route'

const mockReplace = jest.fn()
const mockBack = jest.fn()
const mockValidate = jest.fn()
const mockAccept = { isPending: false, mutateAsync: jest.fn() }

jest.mock('expo-router', () => ({ useRouter: () => ({ replace: mockReplace, back: mockBack, canGoBack: () => true }) }))
jest.mock('@/components/providers/product-runtime-provider', () => ({ useProductRuntime: () => ({ validateHouseholdInvite: mockValidate }) }))
jest.mock('./use-accept-household-invite', () => ({ useAcceptHouseholdInvite: () => mockAccept }))

const validInvite = { email: 'me@example.com', expiresAt: '2026-11-20T10:00:00.000Z', inviterName: 'Ana', householdName: 'Casa Silva', role: 'viewer' }

const renderRoute = async () => {
  const i18n = await initMobileI18n('en')
  const view = await render(
    <I18nextProvider i18n={i18n}>
      <HouseholdJoinRoute />
    </I18nextProvider>,
  )
  return { view, t: i18n.t.bind(i18n) }
}

describe('HouseholdJoinRoute', () => {
  beforeEach(() => {
    mockReplace.mockReset()
    mockBack.mockReset()
    mockValidate.mockReset().mockResolvedValue({ status: 'valid', invite: validInvite })
    mockAccept.mutateAsync.mockReset().mockResolvedValue(undefined)
    takeJoinInviteToken()
    setJoinInviteToken('tok-1')
  })

  it('names the household, the role and what happens to current data, and never joins without the tap', async () => {
    const { view, t } = await renderRoute()
    expect(await view.findByText(t('household.joinExisting.titleHousehold', { name: 'Casa Silva' }))).toBeOnTheScreen()
    expect(mockValidate).toHaveBeenCalledWith('tok-1')
    expect(view.getByText(t('household.joinExisting.role', { role: t('household.members.roleViewer') }))).toBeOnTheScreen()
    for (const key of ['emptyOnly', 'leftBehind', 'banksDisconnected', 'yoursStays']) {
      expect(view.getByText(t(`household.joinExisting.consequences.${key}`))).toBeOnTheScreen()
    }
    expect(mockAccept.mutateAsync).not.toHaveBeenCalled()
  })

  it('falls back to the inviter name when the household has none', async () => {
    mockValidate.mockResolvedValue({ status: 'valid', invite: { ...validInvite, householdName: null } })
    const { view, t } = await renderRoute()
    expect(await view.findByText(t('household.joinExisting.titleInviter', { name: 'Ana' }))).toBeOnTheScreen()
  })

  it('accepts on Join and opens the new household', async () => {
    const { view, t } = await renderRoute()
    await fireEvent.press(await view.findByRole('button', { name: t('household.joinExisting.join') }))
    await waitFor(() => expect(mockAccept.mutateAsync).toHaveBeenCalledWith('tok-1'))
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/settings/household'))
  })

  it.each([
    ['household_has_data', 409, 'household-has-data'],
    ['household_has_members', 409, 'household-has-members'],
    ['already_household_member', 409, 'already-member'],
    ['household_full', 409, 'household-full'],
    ['invite_email_mismatch', 400, 'email-mismatch'],
    ['invite_expired', 400, 'expired'],
  ] as const)('explains a %s refusal in its own words and stays put', async (serverCode, status, failure) => {
    mockAccept.mutateAsync.mockRejectedValue(new ApiError('http', status, { serverCode }))
    const { view, t } = await renderRoute()
    await fireEvent.press(await view.findByRole('button', { name: t('household.joinExisting.join') }))
    expect(await view.findByText(t(`household.joinExisting.failures.${failure}`))).toBeOnTheScreen()
    expect(mockReplace).not.toHaveBeenCalled()
  })

  it('shows an invalid invite when validation refuses the token', async () => {
    mockValidate.mockResolvedValue({ status: 'invalid' })
    const { view, t } = await renderRoute()
    expect(await view.findByText(t('household.joinExisting.invalidTitle'))).toBeOnTheScreen()
    expect(view.queryByRole('button', { name: t('household.joinExisting.join') })).not.toBeOnTheScreen()
  })

  it('shows an invalid invite when opened without a token', async () => {
    takeJoinInviteToken()
    const { view, t } = await renderRoute()
    expect(await view.findByText(t('household.joinExisting.invalidTitle'))).toBeOnTheScreen()
    expect(mockValidate).not.toHaveBeenCalled()
  })

  it('retries validation when it could not be reached', async () => {
    mockValidate.mockResolvedValueOnce({ status: 'unavailable' })
    const { view, t } = await renderRoute()
    await fireEvent.press(await view.findByRole('button', { name: t('common.retry') }))
    expect(await view.findByText(t('household.joinExisting.titleHousehold', { name: 'Casa Silva' }))).toBeOnTheScreen()
    expect(mockValidate).toHaveBeenCalledTimes(2)
  })

  it('goes back on Not now without joining', async () => {
    const { view, t } = await renderRoute()
    await fireEvent.press(await view.findByRole('button', { name: t('household.joinExisting.notNow') }))
    expect(mockBack).toHaveBeenCalledTimes(1)
    expect(mockAccept.mutateAsync).not.toHaveBeenCalled()
  })
})
