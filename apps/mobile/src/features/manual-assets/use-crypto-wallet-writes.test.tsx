import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react-native'
import type { ReactNode } from 'react'

import { ApiError } from '@/lib/api/errors'

import { BTC_ADDRESS, ETH_ADDRESS, HEX_PRIVATE_KEY, SEED_PHRASE, walletAssetFixture, walletFixture } from './test-fixtures'
import {
  classifyCryptoWalletWriteFailure,
  useAddCryptoWalletAddress,
  useCreateCryptoWallet,
  useDeleteCryptoWallet,
  useRemoveCryptoWalletAddress,
  useSetCryptoWalletAddressLabel,
  useSetCryptoWalletTokenTracked,
  useSyncCryptoWallet,
  useUpdateCryptoWallet,
  WalletSecretBlockedError,
} from './use-crypto-wallet-writes'

const mockWrite = jest.fn()
jest.mock('@/components/providers/product-runtime-provider', () => ({ useProductRuntime: () => ({ runtime: { epochId: 8, apiClient: { write: mockWrite } }, blockAccess: jest.fn() }) }))

const setup = () => {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false, gcTime: 0 } } })
  return { client, wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> }
}

const body = { name: 'Cold storage', isPrivate: false, addresses: [{ chain: 'bitcoin' as const, address: BTC_ADDRESS }, { chain: 'ethereum' as const, address: ETH_ADDRESS, label: 'Main' }] }

const loanQueries = (invalidate: jest.SpyInstance) => invalidate.mock.calls
  .map(([filters]) => filters?.predicate)
  .filter((predicate): predicate is (query: { queryKey: readonly unknown[] }) => boolean => typeof predicate === 'function')

describe('crypto wallet writes', () => {
  beforeEach(() => mockWrite.mockReset())

  it('creates a wallet with the contract body and refreshes the assets and net worth', async () => {
    const { client, wrapper } = setup()
    const invalidate = jest.spyOn(client, 'invalidateQueries')
    mockWrite.mockImplementation(async (_endpoint, options) => { options.commit(undefined); return { asset: walletAssetFixture, wallet: walletFixture } })
    const hook = await renderHook(() => useCreateCryptoWallet(), { wrapper })
    await act(async () => { await hook.result.current.mutateAsync(body) })
    expect(mockWrite.mock.calls[0][0]).toMatchObject({ method: 'POST', path: '/v1/manual-assets/crypto-wallets', successStatuses: [201] })
    expect(mockWrite.mock.calls[0][1].body).toEqual(body)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['manual-assets', 'list', 8], exact: true })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['net-worth', 8] })
    await hook.unmount(); client.clear()
  })

  it.each([['a private key', HEX_PRIVATE_KEY], ['a recovery phrase', SEED_PHRASE]])('never sends %s, and the error does not carry it', async (_label, secret) => {
    const { client, wrapper } = setup()
    const create = await renderHook(() => useCreateCryptoWallet(), { wrapper })
    let caught: unknown
    await act(async () => { await create.result.current.mutateAsync({ ...body, addresses: [body.addresses[0], { chain: 'ethereum', address: secret }] }).catch((error: unknown) => { caught = error }) })
    expect(caught).toBeInstanceOf(WalletSecretBlockedError)
    expect((caught as WalletSecretBlockedError).addressIndexes).toEqual([1])
    expect(JSON.stringify(caught)).not.toContain(secret.slice(0, 12))
    expect((caught as Error).message).not.toContain(secret.slice(0, 12))
    const add = await renderHook(() => useAddCryptoWalletAddress(), { wrapper })
    await act(async () => { await expect(add.result.current.mutateAsync({ assetId: 21, value: { chain: 'bitcoin', address: secret } })).rejects.toBeInstanceOf(WalletSecretBlockedError) })
    expect(mockWrite).not.toHaveBeenCalled()
    await create.unmount(); await add.unmount(); client.clear()
  })

  it('ticks a token, labels and removes an address and asks for a sync, refreshing that wallet', async () => {
    const { client, wrapper } = setup()
    const invalidate = jest.spyOn(client, 'invalidateQueries')
    mockWrite.mockImplementation(async (_endpoint, options) => { options.commit(undefined); return { wallet: walletFixture } })
    const toggle = await renderHook(() => useSetCryptoWalletTokenTracked(), { wrapper })
    const label = await renderHook(() => useSetCryptoWalletAddressLabel(), { wrapper })
    const remove = await renderHook(() => useRemoveCryptoWalletAddress(), { wrapper })
    const sync = await renderHook(() => useSyncCryptoWallet(), { wrapper })
    await act(async () => {
      await toggle.result.current.mutateAsync({ assetId: 21, tokenId: 44, tracked: true })
      await label.result.current.mutateAsync({ assetId: 21, addressId: 31, label: '  ' })
      await remove.result.current.mutateAsync({ assetId: 21, addressId: 32 })
      await sync.result.current.mutateAsync({ assetId: 21 })
    })
    expect(mockWrite.mock.calls.map(([endpoint, options]) => [endpoint.method, endpoint.path, options.body])).toEqual([
      ['PATCH', '/v1/manual-assets/21/tokens/44', { tracked: true }],
      // A blank label clears it.
      ['PATCH', '/v1/manual-assets/21/addresses/31', { label: null }],
      ['DELETE', '/v1/manual-assets/21/addresses/32', undefined],
      ['POST', '/v1/manual-assets/21/sync', undefined],
    ])
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['manual-assets', 'detail', 8, 21], exact: true })
    await toggle.unmount(); await label.unmount(); await remove.unmount(); await sync.unmount(); client.clear()
  })

  it('renames a wallet or changes its privacy with the asset PATCH, refreshing that wallet', async () => {
    const { client, wrapper } = setup()
    const invalidate = jest.spyOn(client, 'invalidateQueries')
    mockWrite.mockImplementation(async (_endpoint, options) => { options.commit(undefined); return { asset: walletAssetFixture } })
    const hook = await renderHook(() => useUpdateCryptoWallet(), { wrapper })
    await act(async () => { await hook.result.current.mutateAsync({ assetId: 21, value: { name: ' Ledger ', isPrivate: true } }) })
    expect(mockWrite.mock.calls[0][0]).toMatchObject({ method: 'PATCH', path: '/v1/manual-assets/21', successStatuses: [200] })
    expect(mockWrite.mock.calls[0][1].body).toEqual({ name: 'Ledger', isPrivate: true })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['manual-assets', 'detail', 8, 21], exact: true })
    // Nothing to change, or a blank name, never reaches the API; nor does a kind or a value.
    await act(async () => { await expect(hook.result.current.mutateAsync({ assetId: 21, value: {} })).rejects.toThrow() })
    await act(async () => { await expect(hook.result.current.mutateAsync({ assetId: 21, value: { name: ' ' } })).rejects.toThrow() })
    await act(async () => { await expect(hook.result.current.mutateAsync({ assetId: 21, value: { kind: 'property' } as never })).rejects.toThrow() })
    expect(mockWrite).toHaveBeenCalledTimes(1)
    await hook.unmount(); client.clear()
  })

  it("edits a wallet's notes and archives or brings it back with the asset PATCH, refreshing it, the list, net worth and the loans", async () => {
    const { client, wrapper } = setup()
    const invalidate = jest.spyOn(client, 'invalidateQueries')
    mockWrite.mockImplementation(async (_endpoint, options) => { options.commit(undefined); return { asset: walletAssetFixture } })
    const hook = await renderHook(() => useUpdateCryptoWallet(), { wrapper })
    await act(async () => { await hook.result.current.mutateAsync({ assetId: 21, value: { notes: 'Kept in the safe' } }) })
    await act(async () => { await hook.result.current.mutateAsync({ assetId: 21, value: { notes: null } }) })
    await act(async () => { await hook.result.current.mutateAsync({ assetId: 21, value: { archived: true } }) })
    await act(async () => { await hook.result.current.mutateAsync({ assetId: 21, value: { archived: false } }) })
    expect(mockWrite.mock.calls.map(([endpoint, options]) => [endpoint.method, endpoint.path, options.body])).toEqual([
      ['PATCH', '/v1/manual-assets/21', { notes: 'Kept in the safe' }],
      ['PATCH', '/v1/manual-assets/21', { notes: null }],
      ['PATCH', '/v1/manual-assets/21', { archived: true }],
      ['PATCH', '/v1/manual-assets/21', { archived: false }],
    ])
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['manual-assets', 'list', 8], exact: true })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['manual-assets', 'detail', 8, 21], exact: true })
    // Not exact: archiving changes net worth today and its history.
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['net-worth', 8] })
    // A loan secured against the wallet shows its name and value.
    const loans = loanQueries(invalidate)
    expect(loans.length).toBeGreaterThan(0)
    expect(loans[0]({ queryKey: ['loans', 'list', 8] })).toBe(true)
    expect(loans[0]({ queryKey: ['loans', 'list', 9] })).toBe(false)
    // Notes over the API's limit never reach it.
    await act(async () => { await expect(hook.result.current.mutateAsync({ assetId: 21, value: { notes: 'x'.repeat(10_001) } })).rejects.toThrow() })
    expect(mockWrite).toHaveBeenCalledTimes(4)
    await hook.unmount(); client.clear()
  })

  it('refreshes nothing when the demo refuses a wallet archive, and says it was the demo', async () => {
    const { client, wrapper } = setup()
    const invalidate = jest.spyOn(client, 'invalidateQueries')
    mockWrite.mockRejectedValue(new ApiError('demo-forbidden'))
    const hook = await renderHook(() => useUpdateCryptoWallet(), { wrapper })
    let failure: unknown
    await act(async () => { failure = await hook.result.current.mutateAsync({ assetId: 21, value: { archived: true } }).catch((error: unknown) => error) })
    expect(classifyCryptoWalletWriteFailure(failure)).toEqual({ kind: 'demo', addressIndex: null })
    expect(invalidate).not.toHaveBeenCalled()
    await hook.unmount(); client.clear()
  })

  it('removes a wallet with the asset DELETE, refreshing the list and net worth but not its gone page', async () => {
    const { client, wrapper } = setup()
    const invalidate = jest.spyOn(client, 'invalidateQueries')
    mockWrite.mockImplementation(async (_endpoint, options) => { options.commit(undefined); return undefined })
    const hook = await renderHook(() => useDeleteCryptoWallet(), { wrapper })
    await act(async () => { await hook.result.current.mutateAsync({ assetId: 21 }) })
    expect(mockWrite.mock.calls[0][0]).toMatchObject({ method: 'DELETE', path: '/v1/manual-assets/21', successStatuses: [204] })
    expect(mockWrite.mock.calls[0][1].body).toBeUndefined()
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['manual-assets', 'list', 8], exact: true })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['net-worth', 8] })
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: ['manual-assets', 'detail', 8, 21], exact: true })
    // The loans lose any link to the gone wallet.
    expect(loanQueries(invalidate)[0]({ queryKey: ['loans', 'detail', 8, 3] })).toBe(true)
    await hook.unmount(); client.clear()
  })

  it('maps the API error codes, with the address they are about', () => {
    const http = (status: number, serverCode?: string, addressIndex?: number) => new ApiError('http', status, { ...(serverCode ? { serverCode } : {}), ...(addressIndex === undefined ? {} : { addressIndex }) })
    expect(classifyCryptoWalletWriteFailure(http(400, 'crypto_wallet_secret_rejected', 0))).toEqual({ kind: 'secret-rejected', addressIndex: 0 })
    expect(classifyCryptoWalletWriteFailure(http(400, 'crypto_wallet_address_invalid', 2))).toEqual({ kind: 'address-invalid', addressIndex: 2 })
    expect(classifyCryptoWalletWriteFailure(http(409, 'crypto_wallet_address_exists'))).toEqual({ kind: 'address-exists', addressIndex: null })
    expect(classifyCryptoWalletWriteFailure(http(501, 'feature_disabled'))).toEqual({ kind: 'feature-disabled', addressIndex: null })
    expect(classifyCryptoWalletWriteFailure(http(501))).toEqual({ kind: 'feature-disabled', addressIndex: null })
    expect(classifyCryptoWalletWriteFailure(http(400, 'something_else'))).toEqual({ kind: 'invalid', addressIndex: null })
    expect(classifyCryptoWalletWriteFailure(new ApiError('demo-forbidden'))).toEqual({ kind: 'demo', addressIndex: null })
    expect(classifyCryptoWalletWriteFailure(new WalletSecretBlockedError([1]))).toEqual({ kind: 'secret-rejected', addressIndex: 1 })
  })
})
