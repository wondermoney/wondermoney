import { fireEvent, render, waitFor } from '@testing-library/react-native'

import { ApiError } from '@/lib/api/errors'

import { AssetCreateRoute, AssetDetailRoute, AssetEditRoute, AssetsRoute, CryptoWalletCreateRoute, ValuationRoute } from './asset-routes'
import { assetDetailFixture, assetFixture, assetsFixture, walletAssetFixture, walletDetailFixture } from './test-fixtures'

const mockPush = jest.fn()
const mockReplace = jest.fn()
let mockParams: { assetId?: string | string[] } = {}
const mockUseAssets = jest.fn()
const mockUseAsset = jest.fn()
const mockCreate = jest.fn()
const mockRecord = jest.fn()
const mockCreateWallet = jest.fn()
const mockToggle = jest.fn()
const mockDeleteWallet = jest.fn()
const mockUpdate = jest.fn()
const mockDelete = jest.fn()
let mockChains: string[] = []
jest.mock('@/lib/server/use-instance', () => ({ useCryptoWalletChains: () => mockChains }))
jest.mock('./use-crypto-wallet-writes', () => {
  const idle = () => ({ mutateAsync: jest.fn(), isPending: false })
  return {
    ...jest.requireActual('./use-crypto-wallet-writes'),
    useCreateCryptoWallet: () => ({ mutateAsync: mockCreateWallet, isPending: false }),
    useSetCryptoWalletTokenTracked: () => ({ mutateAsync: mockToggle, isPending: false }),
    useAddCryptoWalletAddress: idle,
    useSetCryptoWalletAddressLabel: idle,
    useRemoveCryptoWalletAddress: idle,
    useSyncCryptoWallet: idle,
    useUpdateCryptoWallet: idle,
    useDeleteCryptoWallet: () => ({ mutateAsync: mockDeleteWallet, isPending: false }),
  }
})
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush, replace: mockReplace }), useLocalSearchParams: () => mockParams }))
jest.mock('./use-manual-assets', () => ({ useManualAssets: () => mockUseAssets(), useManualAsset: (id: number | null) => mockUseAsset(id) }))
jest.mock('@/features/loans/use-loan-currencies', () => ({ useLoanCurrencies: () => ({ isLoading: false, data: { currencies: [{ currencyKey: 1, code: 'EUR', description: 'Euro' }] } }) }))
jest.mock('./use-manual-asset-writes', () => ({
  ...jest.requireActual('./use-manual-asset-writes'),
  useCreateManualAsset: () => ({ mutateAsync: mockCreate, isPending: false }),
  useRecordValuation: () => ({ mutateAsync: mockRecord, isPending: false }),
  useUpdateManualAsset: () => ({ mutateAsync: mockUpdate, isPending: false }),
  useDeleteManualAsset: () => ({ mutateAsync: mockDelete, isPending: false }),
}))
const pressable = (label: string, onPress: () => void) => {
  const Native = jest.requireActual<typeof import('react-native')>('react-native')
  return <Native.Pressable key={label} accessibilityRole="button" accessibilityLabel={label} onPress={onPress}><Native.Text>{label}</Native.Text></Native.Pressable>
}
jest.mock('./assets-screen', () => ({ AssetsScreen: ({ state, onOpenAsset, onCreateAsset, onCreateWallet }: { state: { status: string }; onOpenAsset: (id: number) => void; onCreateAsset: () => void; onCreateWallet?: () => void }) => { const Native = jest.requireActual<typeof import('react-native')>('react-native'); return <><Native.Text>{state.status}</Native.Text>{pressable('Asset row', () => onOpenAsset(7))}{pressable('Add', onCreateAsset)}{onCreateWallet ? pressable('Add wallet', onCreateWallet) : null}</> } }))
type MockManage = { onEdit: () => void; onSetArchived: (archived: boolean) => Promise<string | null>; onDelete: () => Promise<string | null> }
jest.mock('./asset-detail-screen', () => ({ AssetDetailScreen: ({ state, onBack, onUpdateValue, wallet, manage }: { state: { status: string }; onBack: () => void; onUpdateValue: () => void; wallet?: { onToggleToken: (id: number, tracked: boolean) => Promise<unknown>; onDeleteWallet: () => Promise<unknown> }; manage?: MockManage }) => {
  const Native = jest.requireActual<typeof import('react-native')>('react-native')
  const [result, setResult] = jest.requireActual<typeof import('react')>('react').useState('none')
  return <><Native.Text>{state.status}</Native.Text><Native.Text>{`result:${result}`}</Native.Text>{pressable('Back', onBack)}{pressable('Update value', onUpdateValue)}{wallet ? pressable('Tick XYZ', () => void wallet.onToggleToken(44, true)) : null}{wallet ? pressable('Remove wallet', () => void wallet.onDeleteWallet()) : null}{manage ? <>{pressable('Edit', manage.onEdit)}{pressable('Archive', () => void manage.onSetArchived(true).then((outcome) => setResult(String(outcome))))}{pressable('Delete', () => void manage.onDelete().then((outcome) => setResult(String(outcome))))}</> : null}</>
} }))
jest.mock('./asset-edit-screen', () => ({ AssetEditScreen: ({ state, outcome, onSave, onBack }: { state: { status: string; asset?: { name: string } }; outcome: string | null; onSave: (value: unknown) => Promise<void>; onBack: () => void }) => { const Native = jest.requireActual<typeof import('react-native')>('react-native'); return <><Native.Text>{`${state.status}:${state.asset?.name ?? ''}`}</Native.Text><Native.Text>{`outcome:${outcome}`}</Native.Text>{pressable('Save', () => void onSave({ name: 'Beach house' }))}{pressable('Close', onBack)}</> } }))
jest.mock('./crypto-wallet-create-screen', () => ({ CryptoWalletCreateScreen: ({ chains, onCreate }: { chains: string[]; onCreate: (value: unknown) => Promise<unknown> }) => { const Native = jest.requireActual<typeof import('react-native')>('react-native'); const [result, setResult] = jest.requireActual<typeof import('react')>('react').useState('none'); return <><Native.Text>{`chains:${chains.join(',')}`}</Native.Text><Native.Text>{`result:${result}`}</Native.Text>{pressable('Create wallet', () => void onCreate({ name: 'Cold storage' }).then((outcome) => setResult(JSON.stringify(outcome))))}</> } }))
jest.mock('./asset-create-screen', () => ({ AssetCreateScreen: ({ userCurrency, outcome, onCreate }: { userCurrency: string | null; outcome: string | null; onCreate: (value: unknown) => Promise<void> }) => { const Native = jest.requireActual<typeof import('react-native')>('react-native'); return <><Native.Text>{`currency:${userCurrency}`}</Native.Text><Native.Text>{`outcome:${outcome}`}</Native.Text>{pressable('Create', () => void onCreate({ name: 'Car' }))}</> } }))
jest.mock('./valuation-screen', () => ({ ValuationScreen: ({ assetName, outcome, onSave }: { assetName: string | null; outcome: string | null; onSave: (value: unknown) => Promise<void> }) => { const Native = jest.requireActual<typeof import('react-native')>('react-native'); return <><Native.Text>{`asset:${assetName}`}</Native.Text><Native.Text>{`outcome:${outcome}`}</Native.Text>{pressable('Save', () => void onSave({ value: 1, date: '2026-11-10' }))}</> } }))

const loaded = (data: unknown) => ({ isInvalidId: false, isAccessTransition: false, isLoading: false, isNotFound: false, data, isRefreshFailure: false, isRefreshing: false, refetch: jest.fn() })

describe('asset routes', () => {
  beforeEach(() => { mockPush.mockReset(); mockReplace.mockReset(); mockUseAssets.mockReset(); mockUseAsset.mockReset(); mockCreate.mockReset(); mockRecord.mockReset(); mockCreateWallet.mockReset(); mockToggle.mockReset(); mockDeleteWallet.mockReset(); mockUpdate.mockReset(); mockDelete.mockReset(); mockChains = []; mockParams = {} })

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

  it('offers Add crypto wallet only when the server reads a chain, and opens its form', async () => {
    mockUseAssets.mockReturnValue(loaded(assetsFixture()))
    const off = await render(<AssetsRoute />)
    expect(off.queryByRole('button', { name: 'Add wallet' })).not.toBeOnTheScreen()
    await off.unmount()
    mockChains = ['ethereum']
    const on = await render(<AssetsRoute />)
    await fireEvent.press(on.getByRole('button', { name: 'Add wallet' }))
    expect(mockPush).toHaveBeenCalledWith('/assets/crypto-wallet')
  })

  it('creates a wallet and opens it, or answers with why it failed', async () => {
    mockChains = ['bitcoin', 'ethereum']
    mockCreateWallet.mockResolvedValueOnce({ asset: walletAssetFixture, wallet: walletDetailFixture().wallet })
    const view = await render(<CryptoWalletCreateRoute />)
    expect(view.getByText('chains:bitcoin,ethereum')).toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Create wallet' }))
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith({ pathname: '/assets/[assetId]', params: { assetId: '21' } }))
    mockCreateWallet.mockRejectedValueOnce(new ApiError('http', 400, { serverCode: 'crypto_wallet_address_invalid', addressIndex: 0 }))
    await fireEvent.press(view.getByRole('button', { name: 'Create wallet' }))
    await waitFor(() => expect(view.getByText('result:{"kind":"address-invalid","addressIndex":0}')).toBeOnTheScreen())
  })

  it("ticks a wallet's token through the PATCH write", async () => {
    mockParams = { assetId: '21' }
    mockUseAsset.mockReturnValue(loaded(walletDetailFixture()))
    mockToggle.mockResolvedValue({})
    const view = await render(<AssetDetailRoute />)
    await fireEvent.press(view.getByRole('button', { name: 'Tick XYZ' }))
    await waitFor(() => expect(mockToggle).toHaveBeenCalledWith({ assetId: 21, tokenId: 44, tracked: true }))
  })

  it('goes back to Assets once the wallet is removed, and stays when that fails', async () => {
    mockParams = { assetId: '21' }
    mockUseAsset.mockReturnValue(loaded(walletDetailFixture()))
    mockDeleteWallet.mockRejectedValueOnce(new ApiError('network')).mockResolvedValueOnce(undefined)
    const view = await render(<AssetDetailRoute />)
    await fireEvent.press(view.getByRole('button', { name: 'Remove wallet' }))
    await waitFor(() => expect(mockDeleteWallet).toHaveBeenCalledWith({ assetId: 21 }))
    expect(mockReplace).not.toHaveBeenCalled()
    await fireEvent.press(view.getByRole('button', { name: 'Remove wallet' }))
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/assets'))
  })

  it('opens Edit asset from the asset page', async () => {
    mockParams = { assetId: '7' }
    mockUseAsset.mockReturnValue(loaded(assetDetailFixture()))
    const view = await render(<AssetDetailRoute />)
    await fireEvent.press(view.getByRole('button', { name: 'Edit' }))
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/assets/[assetId]/edit', params: { assetId: '7' } })
  })

  it('archives through the PATCH, and answers the demo with its own reason', async () => {
    mockParams = { assetId: '7' }
    mockUseAsset.mockReturnValue(loaded(assetDetailFixture()))
    mockUpdate.mockResolvedValueOnce({ asset: assetFixture }).mockRejectedValueOnce(new ApiError('demo-forbidden'))
    const view = await render(<AssetDetailRoute />)
    await fireEvent.press(view.getByRole('button', { name: 'Archive' }))
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledWith({ assetId: 7, value: { archived: true } }))
    await waitFor(() => expect(view.getByText('result:null')).toBeOnTheScreen())
    await fireEvent.press(view.getByRole('button', { name: 'Archive' }))
    await waitFor(() => expect(view.getByText('result:demo')).toBeOnTheScreen())
    expect(mockReplace).not.toHaveBeenCalled()
  })

  it('goes back to Assets once the asset is deleted, and stays when the demo refuses it', async () => {
    mockParams = { assetId: '7' }
    mockUseAsset.mockReturnValue(loaded(assetDetailFixture()))
    mockDelete.mockRejectedValueOnce(new ApiError('demo-forbidden')).mockResolvedValueOnce(undefined)
    const view = await render(<AssetDetailRoute />)
    await fireEvent.press(view.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(view.getByText('result:demo')).toBeOnTheScreen())
    expect(mockDelete).toHaveBeenCalledWith({ assetId: 7 })
    expect(mockReplace).not.toHaveBeenCalled()
    await fireEvent.press(view.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/assets'))
  })

  it('edits the asset and returns to it, or shows why the save failed', async () => {
    mockParams = { assetId: '7' }
    mockUseAsset.mockReturnValue(loaded(assetDetailFixture()))
    mockUpdate.mockRejectedValueOnce(new ApiError('demo-forbidden')).mockResolvedValueOnce({ asset: assetFixture })
    const view = await render(<AssetEditRoute />)
    expect(view.getByText('loaded:Family home')).toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(view.getByText('outcome:demo')).toBeOnTheScreen())
    expect(mockReplace).not.toHaveBeenCalled()
    await fireEvent.press(view.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(mockUpdate).toHaveBeenLastCalledWith({ assetId: 7, value: { name: 'Beach house' } }))
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith({ pathname: '/assets/[assetId]', params: { assetId: '7' } }))
  })

  it('treats a missing or malformed asset on Edit asset as not found', async () => {
    mockParams = { assetId: '7' }
    mockUseAsset.mockReturnValue({ ...loaded(undefined), isNotFound: true, error: new ApiError('http', 404) })
    const gone = await render(<AssetEditRoute />)
    expect(gone.getByText('not-found:')).toBeOnTheScreen()
    await gone.unmount()
    mockParams = { assetId: 'abc' }
    mockUseAsset.mockReturnValue({ isInvalidId: true, refetch: jest.fn() })
    const invalid = await render(<AssetEditRoute />)
    expect(invalid.getByText('invalid-id:')).toBeOnTheScreen()
    await fireEvent.press(invalid.getByRole('button', { name: 'Close' }))
    expect(mockReplace).toHaveBeenCalledWith('/assets')
  })
})
