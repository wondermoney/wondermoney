import { fireEvent, render, waitFor } from '@testing-library/react-native'

import { ApiError } from '@/lib/api/errors'

import { LoanEditRoute } from './loan-edit-route'

let mockParams: { loanId?: string | string[] } = { loanId: '7' }
const mockReplace = jest.fn()
const mockUseLoan = jest.fn()
const mockUseManualAssets = jest.fn()
const mockMutation = { isPending: false, mutateAsync: jest.fn(), isLoanPending: jest.fn(() => false), requiresAuthoritativeRefresh: jest.fn(() => false), markAuthoritativeRefresh: jest.fn() }

jest.mock('expo-router', () => ({ useLocalSearchParams: () => mockParams, useRouter: () => ({ replace: mockReplace }) }))
jest.mock('./use-loan', () => ({ useLoan: (...args: unknown[]) => mockUseLoan(...args) }))
jest.mock('@/features/manual-assets/use-manual-assets', () => ({ useManualAssets: () => mockUseManualAssets() }))
jest.mock('./use-loan-metadata-mutation', () => ({ useLoanMetadataMutation: () => mockMutation }))
jest.mock('./loan-edit-screen', () => ({
  LoanEditScreen: ({ state, onSaveLoan, onRefreshAuthoritative, securedAssets }: { state: { status: string; model?: { name: string; providerName: string | null; includeInNetWorth: boolean; type?: string; openingPrincipalBalance?: number; openingBalanceDate?: string; currencyCode?: string | null; securedAssetKey?: number | null } }; onSaveLoan: (value: { notes?: string; includeInNetWorth?: boolean }) => Promise<void>; onRefreshAuthoritative: () => Promise<unknown>; securedAssets?: { key: number; name: string }[] }) => {
    const Native = jest.requireActual<typeof import('react-native')>('react-native')
    return <><Native.Text>{`${state.status}:${state.model?.name ?? '-'}:${String(state.model?.providerName)}:${String(state.model?.includeInNetWorth)}:${state.model?.type ?? '-'}:${state.model?.openingPrincipalBalance ?? '-'}`}</Native.Text><Native.Text>{`date:${state.model?.openingBalanceDate ?? '-'}:${state.model?.currencyCode ?? '-'}`}</Native.Text><Native.Text>{`secured:${String(state.model?.securedAssetKey)}:${(securedAssets ?? []).map((asset) => `${asset.key}=${asset.name}`).join(',')}`}</Native.Text><Native.Pressable accessibilityRole="button" accessibilityLabel="Save loan metadata route" onPress={() => void onSaveLoan({ notes: '' })} /><Native.Pressable accessibilityRole="button" accessibilityLabel="Save loan inclusion route" onPress={() => void onSaveLoan({ includeInNetWorth: false })} /><Native.Pressable accessibilityRole="button" accessibilityLabel="Refresh authoritative loan route" onPress={() => void onRefreshAuthoritative()} /></>
  },
}))

describe('loan edit route', () => {
  beforeEach(() => {
    mockParams = { loanId: '7' }
    mockReplace.mockReset()
    mockMutation.mutateAsync.mockReset().mockResolvedValue(undefined)
    mockMutation.markAuthoritativeRefresh.mockReset()
    mockMutation.isLoanPending.mockReset().mockReturnValue(false)
    mockMutation.requiresAuthoritativeRefresh.mockReset().mockReturnValue(false)
    mockUseManualAssets.mockReset().mockReturnValue({ data: undefined })
    mockUseLoan.mockReset().mockReturnValue({ data: { loan: { loanKey: 7, name: 'Authoritative loan', providerName: null, notes: 'Note', includeInNetWorth: true, type: 'MORTGAGE', openingPrincipalBalance: 250_000, openingBalanceDate: '2026-01-01', currency: { code: 'EUR', currencyKey: 1 } } }, isInvalidId: false, isLoading: false, isAccessTransition: false, isRefreshFailure: false, refetch: jest.fn() })
  })

  it('clears the write barrier only after a successful strict authoritative detail refresh', async () => {
    const refetch = jest.fn()
      .mockResolvedValueOnce({ data: { loan: { loanKey: 7, name: 'Cached', providerName: null, notes: 'Draft base', includeInNetWorth: true, openingBalanceDate: '2026-01-01', currency: { code: 'EUR', currencyKey: 1 } } }, error: new ApiError('network') })
      .mockResolvedValueOnce({ data: { loan: { loanKey: 7, name: 'Fresh', providerName: 'Bank', notes: null, includeInNetWorth: false, openingBalanceDate: '2026-01-01', currency: { code: 'EUR', currencyKey: 1 } } }, error: null })
    mockUseLoan.mockReturnValue({ data: { loan: { loanKey: 7, name: 'Cached', providerName: null, notes: 'Draft base', includeInNetWorth: true, openingBalanceDate: '2026-01-01', currency: { code: 'EUR', currencyKey: 1 } } }, isInvalidId: false, isLoading: false, isAccessTransition: false, isRefreshFailure: true, refetch })
    const view = await render(<LoanEditRoute />)

    await fireEvent.press(view.getByRole('button', { name: 'Refresh authoritative loan route' }))
    expect(mockMutation.markAuthoritativeRefresh).not.toHaveBeenCalled()
    await fireEvent.press(view.getByRole('button', { name: 'Refresh authoritative loan route' }))
    await waitFor(() => expect(mockMutation.markAuthoritativeRefresh).toHaveBeenCalledWith(7))
  })

  it('loads authoritative detail, mapping the widened financial fields alongside sparse descriptive metadata', async () => {
    const view = await render(<LoanEditRoute />)
    expect(mockUseLoan).toHaveBeenCalledWith(7)
    expect(view.getByText('loaded:Authoritative loan:null:true:MORTGAGE:250000')).toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Save loan metadata route' }))
    expect(mockMutation.mutateAsync).toHaveBeenCalledWith({ loanId: 7, value: { notes: '' } })
    await fireEvent.press(view.getByRole('button', { name: 'Save loan inclusion route' }))
    expect(mockMutation.mutateAsync).toHaveBeenCalledWith({ loanId: 7, value: { includeInNetWorth: false } })
  })

  it('hands the form a date-only start date and the loan currency, even when the API sends a datetime', async () => {
    mockUseLoan.mockReturnValue({ data: { loan: { loanKey: 7, name: 'Mortgage', providerName: null, notes: null, includeInNetWorth: true, type: 'MORTGAGE', openingPrincipalBalance: 171_400, openingBalanceDate: '2021-03-15T00:00:00.000Z', currency: { code: 'EUR', currencyKey: 1 } } }, isInvalidId: false, isLoading: false, isAccessTransition: false, isRefreshFailure: false, refetch: jest.fn() })
    const view = await render(<LoanEditRoute />)
    expect(view.getByText('date:2021-03-15:EUR')).toBeOnTheScreen()
  })

  it('offers the household\'s current assets plus the linked one, archived or not, as the secured-against choices', async () => {
    mockUseLoan.mockReturnValue({ data: { loan: { loanKey: 7, name: 'Mortgage', providerName: null, notes: null, includeInNetWorth: true, type: 'MORTGAGE', openingPrincipalBalance: 171_400, openingBalanceDate: '2021-03-15', currency: { code: 'EUR', currencyKey: 1 }, securedAsset: { key: 4, name: 'Old flat', currency: 'EUR', value: null } } }, isInvalidId: false, isLoading: false, isAccessTransition: false, isRefreshFailure: false, refetch: jest.fn() })
    mockUseManualAssets.mockReturnValue({ data: { assets: [
      { manualAssetKey: 9, name: 'Family home', archived: false },
      { manualAssetKey: 4, name: 'Old flat', archived: true },
      { manualAssetKey: 5, name: 'Sold car', archived: true },
      { manualAssetKey: 2, name: 'Car', archived: false },
    ] } })
    const view = await render(<LoanEditRoute />)
    expect(view.getByText('secured:4:2=Car,9=Family home,4=Old flat')).toBeOnTheScreen()
  })

  it('keeps the linked asset as a choice while the asset list is unavailable, and maps no link as null', async () => {
    mockUseLoan.mockReturnValue({ data: { loan: { loanKey: 7, name: 'Mortgage', providerName: null, notes: null, includeInNetWorth: true, type: 'MORTGAGE', openingPrincipalBalance: 171_400, openingBalanceDate: '2021-03-15', currency: { code: 'EUR', currencyKey: 1 }, securedAsset: { key: 4, name: 'Family home', currency: 'EUR', value: 250_000 } } }, isInvalidId: false, isLoading: false, isAccessTransition: false, isRefreshFailure: false, refetch: jest.fn() })
    const view = await render(<LoanEditRoute />)
    expect(view.getByText('secured:4:4=Family home')).toBeOnTheScreen()
    mockUseLoan.mockReturnValue({ data: { loan: { loanKey: 7, name: 'Mortgage', providerName: null, notes: null, includeInNetWorth: true, type: 'MORTGAGE', openingPrincipalBalance: 171_400, openingBalanceDate: '2021-03-15', currency: { code: 'EUR', currencyKey: 1 }, securedAsset: null } }, isInvalidId: false, isLoading: false, isAccessTransition: false, isRefreshFailure: false, refetch: jest.fn() })
    await view.rerender(<LoanEditRoute />)
    expect(view.getByText('secured:null:')).toBeOnTheScreen()
  })

  it.each([
    ['invalid-route', { isInvalidId: true }],
    ['not-found', { isInvalidId: false, isLoading: false, isAccessTransition: false, isNotFound: true }],
    ['invalid-response', { isInvalidId: false, isLoading: false, isAccessTransition: false, error: new ApiError('invalid-response') }],
    ['access-transition', { isInvalidId: false, isLoading: false, isAccessTransition: true }],
  ])('maps %s distinctly', async (label, result) => {
    mockUseLoan.mockReturnValue({ refetch: jest.fn(), ...result })
    const view = await render(<LoanEditRoute />)
    expect(view.getByText(`${label}:-:undefined:undefined:-:-`)).toBeOnTheScreen()
  })
})
