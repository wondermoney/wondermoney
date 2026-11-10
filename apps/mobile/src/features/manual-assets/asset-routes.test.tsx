import { fireEvent, render, waitFor } from '@testing-library/react-native'

import { ApiError } from '@/lib/api/errors'

import { AssetCreateRoute, AssetDetailRoute, AssetsRoute, ValuationRoute } from './asset-routes'
import { assetDetailFixture, assetFixture, assetsFixture } from './test-fixtures'

const mockPush = jest.fn()
const mockReplace = jest.fn()
let mockParams: { assetId?: string | string[] } = {}
const mockUseAssets = jest.fn()
const mockUseAsset = jest.fn()
const mockCreate = jest.fn()
const mockRecord = jest.fn()
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush, replace: mockReplace }), useLocalSearchParams: () => mockParams }))
jest.mock('./use-manual-assets', () => ({ useManualAssets: () => mockUseAssets(), useManualAsset: (id: number | null) => mockUseAsset(id) }))
jest.mock('@/features/loans/use-loan-currencies', () => ({ useLoanCurrencies: () => ({ isLoading: false, data: { currencies: [{ currencyKey: 1, code: 'EUR', description: 'Euro' }] } }) }))
jest.mock('./use-manual-asset-writes', () => ({
  ...jest.requireActual('./use-manual-asset-writes'),
  useCreateManualAsset: () => ({ mutateAsync: mockCreate, isPending: false }),
  useRecordValuation: () => ({ mutateAsync: mockRecord, isPending: false }),
}))
const pressable = (label: string, onPress: () => void) => {
  const Native = jest.requireActual<typeof import('react-native')>('react-native')
  return <Native.Pressable key={label} accessibilityRole="button" accessibilityLabel={label} onPress={onPress}><Native.Text>{label}</Native.Text></Native.Pressable>
}
jest.mock('./assets-screen', () => ({ AssetsScreen: ({ state, onOpenAsset, onCreateAsset }: { state: { status: string }; onOpenAsset: (id: number) => void; onCreateAsset: () => void }) => { const Native = jest.requireActual<typeof import('react-native')>('react-native'); return <><Native.Text>{state.status}</Native.Text>{pressable('Asset row', () => onOpenAsset(7))}{pressable('Add', onCreateAsset)}</> } }))
jest.mock('./asset-detail-screen', () => ({ AssetDetailScreen: ({ state, onBack, onUpdateValue }: { state: { status: string }; onBack: () => void; onUpdateValue: () => void }) => { const Native = jest.requireActual<typeof import('react-native')>('react-native'); return <><Native.Text>{state.status}</Native.Text>{pressable('Back', onBack)}{pressable('Update value', onUpdateValue)}</> } }))
jest.mock('./asset-create-screen', () => ({ AssetCreateScreen: ({ userCurrency, outcome, onCreate }: { userCurrency: string | null; outcome: string | null; onCreate: (value: unknown) => Promise<void> }) => { const Native = jest.requireActual<typeof import('react-native')>('react-native'); return <><Native.Text>{`currency:${userCurrency}`}</Native.Text><Native.Text>{`outcome:${outcome}`}</Native.Text>{pressable('Create', () => void onCreate({ name: 'Car' }))}</> } }))
jest.mock('./valuation-screen', () => ({ ValuationScreen: ({ assetName, outcome, onSave }: { assetName: string | null; outcome: string | null; onSave: (value: unknown) => Promise<void> }) => { const Native = jest.requireActual<typeof import('react-native')>('react-native'); return <><Native.Text>{`asset:${assetName}`}</Native.Text><Native.Text>{`outcome:${outcome}`}</Native.Text>{pressable('Save', () => void onSave({ value: 1, date: '2026-11-10' }))}</> } }))

const loaded = (data: unknown) => ({ isInvalidId: false, isAccessTransition: false, isLoading: false, isNotFound: false, data, isRefreshFailure: false, isRefreshing: false, refetch: jest.fn() })

describe('asset routes', () => {
  beforeEach(() => { mockPush.mockReset(); mockReplace.mockReset(); mockUseAssets.mockReset(); mockUseAsset.mockReset(); mockCreate.mockReset(); mockRecord.mockReset(); mockParams = {} })

  it('opens an asset and the add form from the list', async () => {
    mockUseAssets.mockReturnValue(loaded(assetsFixture()))
    const view = await render(<AssetsRoute />)
    expect(view.getByText('loaded')).toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Asset row' }))
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/assets/[assetId]', params: { assetId: '7' } })
    await fireEvent.press(view.getByRole('button', { name: 'Add' }))
    expect(mockPush).toHaveBeenCalledWith('/assets/create')
  })

  it('treats a 404, such as the other member\'s private asset, as not found', async () => {
    mockParams = { assetId: '7' }
    mockUseAsset.mockReturnValue({ ...loaded(undefined), isNotFound: true, error: new ApiError('http', 404) })
    const view = await render(<AssetDetailRoute />)
    expect(view.getByText('not-found')).toBeOnTheScreen()
  })

  it('passes a malformed id as null, and goes to Update value and back to Assets', async () => {
    mockParams = { assetId: ['7'] }
    mockUseAsset.mockReturnValue({ isInvalidId: true, refetch: jest.fn() })
    const invalid = await render(<AssetDetailRoute />)
    expect(mockUseAsset).toHaveBeenCalledWith(null)
    expect(invalid.getByText('invalid-id')).toBeOnTheScreen()
    await invalid.unmount()
    mockParams = { assetId: '7' }
    mockUseAsset.mockReturnValue(loaded(assetDetailFixture()))
    const view = await render(<AssetDetailRoute />)
    await fireEvent.press(view.getByRole('button', { name: 'Update value' }))
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/assets/[assetId]/value', params: { assetId: '7' } })
    await fireEvent.press(view.getByRole('button', { name: 'Back' }))
    expect(mockReplace).toHaveBeenCalledWith('/assets')
  })

  it("starts a new asset in the viewer's currency and opens it once created", async () => {
    mockUseAssets.mockReturnValue(loaded(assetsFixture([], { currencyCode: 'GBP' })))
    mockCreate.mockResolvedValue({ asset: { ...assetFixture, manualAssetKey: 12 } })
    const view = await render(<AssetCreateRoute />)
    expect(view.getByText('currency:GBP')).toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Create' }))
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith({ pathname: '/assets/[assetId]', params: { assetId: '12' } }))
  })

  it('records a valuation and returns to the asset, or shows why it failed', async () => {
    mockParams = { assetId: '7' }
    mockUseAsset.mockReturnValue(loaded(assetDetailFixture()))
    mockRecord.mockResolvedValueOnce({})
    const view = await render(<ValuationRoute />)
    expect(view.getByText('asset:Family home')).toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(mockRecord).toHaveBeenCalledWith({ assetId: 7, value: { value: 1, date: '2026-11-10' } }))
    expect(mockReplace).toHaveBeenCalledWith({ pathname: '/assets/[assetId]', params: { assetId: '7' } })
    mockRecord.mockRejectedValueOnce(new ApiError('demo-forbidden'))
    await fireEvent.press(view.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(view.getByText('outcome:demo')).toBeOnTheScreen())
  })
})
