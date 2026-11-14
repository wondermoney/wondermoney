import { fireEvent, render } from '@testing-library/react-native'

import { ApiError } from '@/lib/api/errors'

import { AccountEditRoute } from './account-edit-route'

let mockParams: { accountId?: string | string[] } = { accountId: '12' }
const mockReplace = jest.fn()
const mockUseAccount = jest.fn()
const mockMutation = { isPending: false, mutateAsync: jest.fn() }
const mockDeleteMutation = { isPending: false, mutateAsync: jest.fn() }
const mockSharesMutation = { isPending: false, mutateAsync: jest.fn() }
const mockUseAccountShares = jest.fn()

jest.mock('expo-router', () => ({ useLocalSearchParams: () => mockParams, useRouter: () => ({ replace: mockReplace }) }))
jest.mock('./use-account', () => ({ useAccount: (...args: unknown[]) => mockUseAccount(...args) }))
jest.mock('./use-account-metadata-mutation', () => ({ useAccountMetadataMutation: () => mockMutation }))
jest.mock('./use-account-delete-mutation', () => ({ useAccountDeleteMutation: () => mockDeleteMutation }))
jest.mock('./use-account-shares', () => ({ useAccountShares: (...args: unknown[]) => mockUseAccountShares(...args), useAccountSharesMutation: () => mockSharesMutation }))
jest.mock('./use-credit-card-mutation', () => ({ useCreditCardMutation: () => ({ isPending: false, mutateAsync: jest.fn() }) }))
jest.mock('@/features/household/use-household-members', () => ({ useHouseholdMembers: () => jest.requireActual('@/features/household/member-attribution').NO_HOUSEHOLD_MEMBERS }))
jest.mock('./account-edit-screen', () => ({
  AccountEditScreen: ({ state, sharing, onSaveAccount, onSaveSharing, onDeleteAccount }: { state: { status: string; model?: { name: string; myAccess?: string } }; sharing: { status: string }; onSaveAccount: (value: { accountName?: string; isPrivate?: boolean }) => Promise<void>; onSaveSharing: (value: { isPrivate: boolean; shares: { appuserKey: number; access: 'read' | 'write' }[] }) => Promise<void>; onDeleteAccount: () => Promise<void> }) => {
    const Native = jest.requireActual<typeof import('react-native')>('react-native')
    return <>
      <Native.Text>{`${state.status}:${state.model?.name ?? '-'}`}</Native.Text>
      <Native.Text>{`access:${state.model?.myAccess ?? '-'}`}</Native.Text>
      <Native.Text>{`sharing:${sharing.status}`}</Native.Text>
      <Native.Pressable accessibilityRole="button" accessibilityLabel="Save sharing route" onPress={() => void onSaveSharing({ isPrivate: true, shares: [{ appuserKey: 4, access: 'read' }] })} />
      <Native.Pressable accessibilityRole="button" accessibilityLabel="Save account route" onPress={() => void onSaveAccount({ accountName: 'Everyday', isPrivate: true })} />
      <Native.Pressable accessibilityRole="button" accessibilityLabel="Delete account route" onPress={() => void onDeleteAccount()} />
    </>
  },
}))

describe('account edit route', () => {
  beforeEach(() => {
    mockParams = { accountId: '12' }
    mockReplace.mockReset()
    mockMutation.mutateAsync.mockReset().mockResolvedValue(undefined)
    mockDeleteMutation.mutateAsync.mockReset().mockResolvedValue(undefined)
    mockSharesMutation.mutateAsync.mockReset().mockResolvedValue(undefined)
    mockUseAccountShares.mockReset().mockReturnValue({ data: undefined, isLoading: true, isUnsupported: false, refetch: jest.fn() })
    mockUseAccount.mockReset().mockReturnValue({
      data: { account: { accountKey: 12, accountName: 'Authoritative', isPrivate: false, isOwnedByViewer: true, myAccess: 'owner' } },
      isInvalidId: false,
      isLoading: false,
      isAccessTransition: false,
      isRefreshFailure: false,
      isNotFound: false,
      error: null,
      refetch: jest.fn(),
    })
  })

  it('loads authoritative detail independently of the list and wires the save action', async () => {
    const view = await render(<AccountEditRoute />)
    expect(mockUseAccount).toHaveBeenCalledWith(12)
    expect(view.getByText('loaded:Authoritative')).toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Save account route' }))
    expect(mockMutation.mutateAsync).toHaveBeenCalledWith({ accountId: 12, value: { accountName: 'Everyday', isPrivate: true } })
  })

  it('reads the account\'s sharing, passes the caller\'s access and saves sharing through the PUT', async () => {
    const view = await render(<AccountEditRoute />)
    expect(mockUseAccountShares).toHaveBeenCalledWith(12)
    expect(view.getByText('access:owner')).toBeOnTheScreen()
    expect(view.getByText('sharing:loading')).toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Save sharing route' }))
    expect(mockSharesMutation.mutateAsync).toHaveBeenCalledWith({ accountId: 12, value: { isPrivate: true, shares: [{ appuserKey: 4, access: 'read' }] } })
  })

  it.each([
    ['loaded', { data: { accountKey: 12, isPrivate: false, canManage: true, members: [] }, isLoading: false, isUnsupported: false }],
    ['unsupported', { data: undefined, isLoading: false, isUnsupported: true }],
    ['error', { data: undefined, isLoading: false, isUnsupported: false }],
  ])('maps the sharing to %s', async (label, result) => {
    mockUseAccountShares.mockReturnValue({ refetch: jest.fn(), ...result })
    const view = await render(<AccountEditRoute />)
    expect(view.getByText(`sharing:${label}`)).toBeOnTheScreen()
  })

  it('deletes the account then navigates back to the accounts list', async () => {
    const view = await render(<AccountEditRoute />)
    await fireEvent.press(view.getByRole('button', { name: 'Delete account route' }))
    expect(mockDeleteMutation.mutateAsync).toHaveBeenCalledWith(12)
    expect(mockReplace).toHaveBeenCalledWith('/accounts')
  })

  it('replaces to the account detail screen (not the list) on back navigation', async () => {
    await render(<AccountEditRoute />)
    expect(mockReplace).not.toHaveBeenCalled()
  })

  it.each([
    ['invalid-id', { isInvalidId: true }],
    ['not-found', { isInvalidId: false, isLoading: false, isAccessTransition: false, isNotFound: true }],
    ['invalid-response', { isInvalidId: false, isLoading: false, isAccessTransition: false, error: new ApiError('invalid-response') }],
    ['access-transition', { isInvalidId: false, isLoading: false, isAccessTransition: true }],
  ])('maps %s distinctly', async (label, result) => {
    mockUseAccount.mockReturnValue({ refetch: jest.fn(), ...result })
    const view = await render(<AccountEditRoute />)
    expect(view.getByText(`${label}:-`)).toBeOnTheScreen()
  })

  it('keeps authoritative data visible with stale status after refresh failure', async () => {
    mockUseAccount.mockReturnValue({
      data: { account: { accountKey: 12, accountName: 'Cached', isPrivate: false, isOwnedByViewer: true } },
      isInvalidId: false,
      isLoading: false,
      isAccessTransition: false,
      isRefreshFailure: true,
      isRefreshing: false,
      refetch: jest.fn(),
    })
    const view = await render(<AccountEditRoute />)
    expect(view.getByText('refresh-error:Cached')).toBeOnTheScreen()
  })
})
