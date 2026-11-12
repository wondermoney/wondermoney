import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, waitFor } from '@testing-library/react-native'
import type { ReactElement, ReactNode } from 'react'

import { ApiError } from '@/lib/api/errors'

import { PortfolioCreateRoute } from './portfolio-create-route'
import { PortfolioSettingsRoute } from './portfolio-settings-route'
import type { PortfolioResponseDto } from './portfolios-contract'

const createPayload = { name: 'Future', currencyId: 151 }
const metadata: { portfolio: PortfolioResponseDto['portfolio'] } = { portfolio: { portfolioKey: 7, name: 'Future', description: null, currencyKey: { code: 'EUR' } } }
const mockRead = jest.fn(); const mockReplace = jest.fn(); const mockUsePreventRemove = jest.fn((_preventRemove: boolean, _onPrevented?: (options: { data: { action: object }; repeat: () => void }) => void) => jest.fn()); const mockBlockAccess = jest.fn(); const mockSignOut = jest.fn()
const mockCreate = { isPending: false, mutateAsync: jest.fn(), unknownOutcome: null as null | { payload: typeof createPayload } }
const mockCurrencies = { data: { currencies: [{ currencyKey: 151, code: 'EUR', description: 'Euro' }] }, isPending: false, isAccessTransition: false, isInvalidResponse: false, refetch: jest.fn() }
const mockDetail = { data: metadata, error: null, isAccessTransition: false, isInvalidId: false, isInvalidResponse: false, isNotFound: false, refetch: jest.fn() }
const mockSettings = { isPending: false, mutateAsync: jest.fn(), unknownOutcome: null as null | { payload: { name?: string; description?: string | null } }, acknowledgeReconciliation: jest.fn() }

jest.mock('expo-router', () => ({ useLocalSearchParams: () => ({ portfolioId: '7' }), usePreventRemove: (preventRemove: boolean, onPrevented?: (options: { data: { action: object }; repeat: () => void }) => void) => mockUsePreventRemove(preventRemove, onPrevented), useRouter: () => ({ replace: mockReplace }) }))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
jest.mock('@/components/providers/product-runtime-provider', () => ({ useProductRuntime: () => ({ runtime: { epochId: 8, apiClient: { read: mockRead } }, blockAccess: mockBlockAccess, signOut: mockSignOut }) }))
jest.mock('./use-portfolio-currencies', () => ({ usePortfolioCurrencies: () => mockCurrencies }))
jest.mock('./use-create-portfolio', () => { const actual = jest.requireActual<typeof import('./use-create-portfolio')>('./use-create-portfolio'); return { ...actual, useCreatePortfolio: () => mockCreate } })
const mockAccounts = { data: { accounts: [{ accountKey: 21, accountName: 'Brokerage cash', accountType: 'INVESTMENT', source: 'manual' }] } }
jest.mock('@/features/accounts/use-accounts', () => ({ useAccounts: () => mockAccounts }))
jest.mock('./use-portfolio-metadata', () => ({ usePortfolioMetadata: () => mockDetail }))
jest.mock('./use-portfolio-settings', () => { const actual = jest.requireActual<typeof import('./use-portfolio-settings')>('./use-portfolio-settings'); return { ...actual, usePortfolioSettings: () => mockSettings } })
jest.mock('./portfolio-create-screen', () => ({ PortfolioCreateScreen: (props: { unknownPayload: unknown; detailState: string; confirmedPortfolioId: number | null; onSubmit: (value: typeof createPayload) => Promise<void>; onRetryDetail: () => Promise<void> }) => { const Native = jest.requireActual<typeof import('react-native')>('react-native'); return <><Native.Text>{`${props.unknownPayload ? 'blocked' : 'open'}:${props.confirmedPortfolioId ?? 'none'}:${props.detailState}`}</Native.Text><Native.Pressable accessibilityRole="button" accessibilityLabel="Submit portfolio test" onPress={() => void props.onSubmit(createPayload)} /><Native.Pressable accessibilityRole="button" accessibilityLabel="Retry portfolio detail test" onPress={() => void props.onRetryDetail()} /></> } }))
let capturedSettingsModel: { benchmarkSymbol: string | null; excluded: boolean; favored: boolean; targetAllocation: Record<string, number> | null; accountLink: unknown } | null = null
let capturedSettingsProps: { failure: string | null; linkHolder?: string | null; accounts?: readonly unknown[] } | null = null
jest.mock('./portfolio-settings-screen', () => ({ PortfolioSettingsScreen: (props: { model: { benchmarkSymbol: string | null; excluded: boolean; favored: boolean; targetAllocation: Record<string, number> | null; accountLink: unknown }; failure: string | null; linkHolder?: string | null; accounts?: readonly unknown[]; unknownPayload: unknown; reconciliation: string | null; onSave: (value: { name?: string; accountLink?: { accountId: number; mode: 'cash_only' } }) => Promise<void>; onReconcile: () => Promise<void>; onAcknowledgeReconciliation: () => void }) => { const Native = jest.requireActual<typeof import('react-native')>('react-native'); capturedSettingsModel = props.model; capturedSettingsProps = props; return <><Native.Pressable accessibilityRole="button" accessibilityLabel="Save link test" onPress={() => void props.onSave({ accountLink: { accountId: 21, mode: 'cash_only' } })} /><Native.Text>{`${props.unknownPayload ? 'settings-blocked' : 'settings-open'}:${props.reconciliation ?? 'idle'}`}</Native.Text><Native.Pressable accessibilityRole="button" accessibilityLabel="Save settings test" onPress={() => void props.onSave({ name: 'Renamed' })} /><Native.Pressable accessibilityRole="button" accessibilityLabel="Reconcile settings test" onPress={() => void props.onReconcile()} /><Native.Pressable accessibilityRole="button" accessibilityLabel="Acknowledge settings test" onPress={props.onAcknowledgeReconciliation} /></> } }))

async function renderRoute(node: ReactElement) { const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } }); const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>; return { client, view: await render(node, { wrapper }) } }

describe('portfolio write routes', () => {
  beforeEach(() => { jest.clearAllMocks(); mockCreate.isPending = false; mockCreate.unknownOutcome = null; mockSettings.isPending = false; mockSettings.unknownOutcome = null; mockDetail.data = metadata; mockDetail.error = null; mockRead.mockResolvedValue(metadata); mockDetail.refetch.mockResolvedValue({ data: metadata, error: null }) })
  it('navigates after POST only when the canonical detail GET matches every created field, and retries GET without reposting', async () => {
    mockCreate.mutateAsync.mockResolvedValue({ portfolioId: 7 }); mockRead.mockResolvedValueOnce({ portfolio: { ...metadata.portfolio, name: 'Different' } }).mockResolvedValueOnce(metadata)
    const { client, view } = await renderRoute(<PortfolioCreateRoute />); await act(async () => { fireEvent.press(view.getByRole('button', { name: 'Submit portfolio test' })) }); await waitFor(() => expect(view.getByText('open:7:unavailable')).toBeOnTheScreen()); expect(mockReplace).not.toHaveBeenCalled(); expect(mockCreate.mutateAsync).toHaveBeenCalledTimes(1)
    await act(async () => { fireEvent.press(view.getByRole('button', { name: 'Retry portfolio detail test' })) }); await waitFor(() => expect(mockReplace).toHaveBeenCalledWith({ pathname: '/portfolio/[portfolioId]', params: { portfolioId: '7' } })); expect(mockCreate.mutateAsync).toHaveBeenCalledTimes(1); expect(mockRead.mock.calls.map(([endpoint]) => endpoint.path)).toEqual(['/v1/portfolio/7', '/v1/portfolio/7']); client.clear()
  })
  it('keeps an unknown create blocked and refreshes the list without reposting or name matching', async () => {
    mockCreate.unknownOutcome = { payload: createPayload }; mockRead.mockResolvedValue({ portfolios: [] }); const { client, view } = await renderRoute(<PortfolioCreateRoute />); await waitFor(() => expect(mockRead).toHaveBeenCalledWith(expect.objectContaining({ path: '/v1/portfolio' }))); await fireEvent.press(view.getByRole('button', { name: 'Submit portfolio test' })); expect(mockCreate.mutateAsync).not.toHaveBeenCalled(); expect(view.getByText('blocked:none:idle')).toBeOnTheScreen(); client.clear()
  })
  it('clears retained settings only when every field matches authoritative detail', async () => {
    mockSettings.unknownOutcome = { payload: { description: null } }; const { client } = await renderRoute(<PortfolioSettingsRoute />); await waitFor(() => expect(mockDetail.refetch).toHaveBeenCalledTimes(1)); expect(mockSettings.acknowledgeReconciliation).toHaveBeenCalledWith('applied'); expect(mockSettings.mutateAsync).not.toHaveBeenCalled(); client.clear()
  })
  it('requires explicit acknowledgement when every retained field differs', async () => {
    mockSettings.unknownOutcome = { payload: { description: null } }; mockDetail.refetch.mockResolvedValue({ data: { portfolio: { ...metadata.portfolio, description: 'Still present' } }, error: null }); const { client, view } = await renderRoute(<PortfolioSettingsRoute />); await waitFor(() => expect(view.getByText('settings-blocked:not-applied')).toBeOnTheScreen()); expect(mockSettings.acknowledgeReconciliation).not.toHaveBeenCalled(); await fireEvent.press(view.getByRole('button', { name: 'Acknowledge settings test' })); expect(mockSettings.acknowledgeReconciliation).toHaveBeenCalledWith('not-applied'); client.clear()
  })
  it('keeps mixed reconciliation uncertain and locked for another refresh', async () => {
    mockSettings.unknownOutcome = { payload: { name: 'Future', description: null } }; mockDetail.refetch.mockResolvedValue({ data: { portfolio: { ...metadata.portfolio, description: 'Still present' } }, error: null }); const { client, view } = await renderRoute(<PortfolioSettingsRoute />); await waitFor(() => expect(view.getByText('settings-blocked:uncertain')).toBeOnTheScreen()); expect(mockSettings.acknowledgeReconciliation).not.toHaveBeenCalled(); client.clear()
  })
  it.each([
    ['failed', { data: undefined, error: new Error('failed') }],
    ['mismatched', { data: { portfolio: { ...metadata.portfolio, portfolioKey: 8 } }, error: null }],
  ])('keeps a %s authoritative read uncertain and locked', async (_label, result) => {
    mockSettings.unknownOutcome = { payload: { description: null } }; mockDetail.refetch.mockResolvedValue(result); const { client, view } = await renderRoute(<PortfolioSettingsRoute />); await waitFor(() => expect(view.getByText('settings-blocked:uncertain')).toBeOnTheScreen()); expect(mockSettings.acknowledgeReconciliation).not.toHaveBeenCalled(); client.clear()
  })
  it('navigates settings only after matching authoritative PUT metadata', async () => {
    mockSettings.mutateAsync.mockResolvedValue(metadata); const { client, view } = await renderRoute(<PortfolioSettingsRoute />); await act(async () => { fireEvent.press(view.getByRole('button', { name: 'Save settings test' })) }); await waitFor(() => expect(mockReplace).toHaveBeenCalledWith({ pathname: '/portfolio/[portfolioId]', params: { portfolioId: '7' } })); expect(mockSettings.mutateAsync).toHaveBeenCalledWith({ name: 'Renamed' }); client.clear()
  })
  it('defaults missing benchmark/excluded/favored fields honestly rather than inventing values', async () => {
    const { client } = await renderRoute(<PortfolioSettingsRoute />)
    await waitFor(() => expect(capturedSettingsModel).toMatchObject({ benchmarkSymbol: null, excluded: false, favored: false }))
    client.clear()
  })
  it('passes through real benchmark/excluded/favored values from authoritative detail', async () => {
    mockDetail.data = { portfolio: { ...metadata.portfolio, benchmarkSymbol: 'SPY', excluded: true, favored: false } }
    const { client } = await renderRoute(<PortfolioSettingsRoute />)
    await waitFor(() => expect(capturedSettingsModel).toMatchObject({ benchmarkSymbol: 'SPY', excluded: true, favored: false }))
    client.clear()
  })
  it('defaults a missing target allocation to null rather than inventing values', async () => {
    const { client } = await renderRoute(<PortfolioSettingsRoute />)
    await waitFor(() => expect(capturedSettingsModel).toMatchObject({ targetAllocation: null }))
    client.clear()
  })
  it('passes through a real target allocation from authoritative detail', async () => {
    mockDetail.data = { portfolio: { ...metadata.portfolio, targetAllocation: { 'Equities': 60, 'Fixed Income': 40 } } }
    const { client } = await renderRoute(<PortfolioSettingsRoute />)
    await waitFor(() => expect(capturedSettingsModel).toMatchObject({ targetAllocation: { 'Equities': 60, 'Fixed Income': 40 } }))
    client.clear()
  })
  it('hands the settings form this member\'s accounts and the stored link', async () => {
    mockDetail.data = { portfolio: { ...metadata.portfolio, accountLink: { accountKey: 21, accountName: 'Brokerage cash', mode: 'cash_only' } } }
    const { client } = await renderRoute(<PortfolioSettingsRoute />)
    await waitFor(() => expect(capturedSettingsModel).toMatchObject({ accountLink: { accountKey: 21, accountName: 'Brokerage cash', mode: 'cash_only' } }))
    expect(capturedSettingsProps?.accounts).toEqual(mockAccounts.data.accounts)
    client.clear()
  })
  it('names the member who holds the link when the save is refused, and stays on settings', async () => {
    mockSettings.mutateAsync.mockRejectedValue(new ApiError('portfolio-link-held', 403, { linkedBy: 'Ana' }))
    const { client, view } = await renderRoute(<PortfolioSettingsRoute />)
    await act(async () => { fireEvent.press(view.getByRole('button', { name: 'Save link test' })) })
    await waitFor(() => expect(capturedSettingsProps).toMatchObject({ failure: 'link-held', linkHolder: 'Ana' }))
    expect(mockReplace).not.toHaveBeenCalled()
    client.clear()
  })
  it('reads an older API\'s plain 403 to a link change as the other member\'s hold', async () => {
    mockSettings.mutateAsync.mockRejectedValue(new ApiError('http', 403))
    const { client, view } = await renderRoute(<PortfolioSettingsRoute />)
    await act(async () => { fireEvent.press(view.getByRole('button', { name: 'Save link test' })) })
    await waitFor(() => expect(capturedSettingsProps).toMatchObject({ failure: 'link-managed', linkHolder: null }))
    client.clear()
  })
})
