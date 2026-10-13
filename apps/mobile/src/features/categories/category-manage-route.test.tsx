import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, waitFor } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { initMobileI18n } from '@/lib/i18n'
import { ApiError } from '@/lib/api/errors'

import { CategoryCreateRoute, CategoryEditRoute } from './category-manage-route'
import type { CategoryWriteGate } from './use-category-write'

const system = { categoryKey: 1, name: 'FOOD', textColor: '#111111', bgColor: '#AABBCC', icon: 'cooking-pot', isSystemCategory: true }
const user = { categoryKey: 2, name: 'Lunch', textColor: '#FFFFFF', bgColor: '#123456', icon: 'coffee', isSystemCategory: false }
const data = { categories: [{ ...system, childCategory: [user] }] }
const mockReplace = jest.fn()
const mockRead = jest.fn()
const mockMutate = jest.fn()
const mockAddListener = jest.fn(() => jest.fn())
const mockDispatch = jest.fn()
let mockParam: string | string[] | undefined
let mockGate: CategoryWriteGate | null = null
let mockPending = false
let mockDemoLocked = false
let mockQuery = { data, isAccessTransition: false, isLoading: false, error: null as Error | null, refetch: jest.fn(async () => undefined) }

jest.mock('expo-router', () => ({ useLocalSearchParams: () => ({ categoryId: mockParam }), useNavigation: () => ({ addListener: mockAddListener, dispatch: mockDispatch }), useRouter: () => ({ replace: mockReplace }) }))
jest.mock('@/components/providers/product-runtime-provider', () => ({ useProductRuntime: () => ({ runtime: { epochId: 3, apiClient: { read: mockRead } } }) }))
jest.mock('./use-categories', () => {
  const actual = jest.requireActual<typeof import('./use-categories')>('./use-categories')
  return { ...actual, useCategories: () => mockQuery }
})
jest.mock('./use-category-write', () => {
  const actual = jest.requireActual<typeof import('./use-category-write')>('./use-category-write')
  return { ...actual, useCategoryWrite: () => ({ isPending: mockPending, mutateAsync: mockMutate, unknownGate: mockGate, demoLocked: mockDemoLocked }) }
})
jest.mock('./category-manage-screen', () => ({
  CategoryManageScreen: (props: { mode: string; unavailable?: string; reconciliation?: string | null; failure?: string | null; demoLocked?: boolean; resetReviewToken?: number; onDirtyChange?: (dirty: boolean) => void; onSubmit: (payload: { name: string; color: string; icon: 'folder' }) => Promise<void> }) => {
    const Native = jest.requireActual<typeof import('react-native')>('react-native')
    return <><Native.Text>{`${props.mode}:${props.unavailable ?? 'ready'}:${props.reconciliation ?? 'open'}:${props.failure ?? 'none'}:${props.demoLocked ? 'demo' : 'writable'}:${props.resetReviewToken ?? 0}`}</Native.Text><Native.Pressable accessibilityRole="button" accessibilityLabel="Submit category route" onPress={() => void props.onSubmit({ name: 'Travel', color: '#123ABC', icon: 'folder' })} /><Native.Pressable accessibilityRole="button" accessibilityLabel="Mark category dirty" onPress={() => props.onDirtyChange?.(true)} /></>
  },
}))

async function renderRoute(element: React.ReactElement) {
  const i18n = await initMobileI18n('en')
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
  client.setQueryData(['categories', 'read', 3], data)
  const view = await render(<I18nextProvider i18n={i18n}><QueryClientProvider client={client}>{element}</QueryClientProvider></I18nextProvider>)
  return { client, view }
}

describe('category management routes', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockParam = undefined
    mockGate = null
    mockPending = false
    mockDemoLocked = false
    mockQuery = { data, isAccessTransition: false, isLoading: false, error: null, refetch: jest.fn(async () => undefined) }
    mockRead.mockResolvedValue(data)
    mockMutate.mockResolvedValue({ category: { categoryKey: 8, name: 'Travel', icon: 'folder', bgColor: '#123ABC' } })
  })

  it('wires create submission to one guarded write and returns to Categories', async () => {
    const { client, view } = await renderRoute(<CategoryCreateRoute />)
    await fireEvent.press(view.getByRole('button', { name: 'Submit category route' }))
    await waitFor(() => expect(mockMutate).toHaveBeenCalledWith({ type: 'create', payload: { name: 'Travel', color: '#123ABC', icon: 'folder' } }))
    expect(mockReplace).toHaveBeenCalledWith('/settings/categories')
    client.clear()
  })

  it.each([
    ['invalid id', '01', 'not-found'],
    ['system category', '1', 'system'],
  ])('blocks %s edit routes before dispatch', async (_label, param, state) => {
    mockParam = param
    const { client, view } = await renderRoute(<CategoryEditRoute />)
    expect(view.getByText(`edit:${state}:open:none:writable:0`)).toBeOnTheScreen()
    expect(mockMutate).not.toHaveBeenCalled()
    client.clear()
  })

  it('latches demo read-only after one forbidden write and does not redispatch', async () => {
    mockMutate.mockRejectedValue(new ApiError('demo-forbidden'))
    const { client, view } = await renderRoute(<CategoryCreateRoute />)
    await fireEvent.press(view.getByRole('button', { name: 'Submit category route' }))
    await waitFor(() => expect(view.getByText('create:ready:open:demo:demo:0')).toBeOnTheScreen())
    await fireEvent.press(view.getByRole('button', { name: 'Submit category route' }))
    expect(mockMutate).toHaveBeenCalledTimes(1)
    client.clear()
  })

  it('prevents stack departure while a write is pending and retains the dirty guard otherwise', async () => {
    mockPending = true
    const pending = await renderRoute(<CategoryCreateRoute />)
    const pendingCall = mockAddListener.mock.calls.at(-1) as unknown as [string, (event: { preventDefault: jest.Mock; data: { action: object } }) => void]
    const pendingListener = pendingCall[1]
    const pendingEvent = { preventDefault: jest.fn(), data: { action: {} } }
    pendingListener(pendingEvent)
    expect(pendingEvent.preventDefault).toHaveBeenCalled()
    await pending.view.unmount(); pending.client.clear()

    mockPending = false
    const dirty = await renderRoute(<CategoryCreateRoute />)
    await fireEvent.press(dirty.view.getByRole('button', { name: 'Mark category dirty' }))
    const dirtyCall = mockAddListener.mock.calls.at(-1) as unknown as [string, (event: { preventDefault: jest.Mock; data: { action: object } }) => void]
    const dirtyListener = dirtyCall[1]
    const dirtyEvent = { preventDefault: jest.fn(), data: { action: {} } }
    dirtyListener(dirtyEvent)
    expect(dirtyEvent.preventDefault).toHaveBeenCalled()
    await dirty.view.unmount(); dirty.client.clear()
  })

  it.each([
    ['absent', { categories: [{ ...system, childCategory: [] }] }, 'not-found'],
    ['now system-owned', { categories: [{ ...system, categoryKey: 2, childCategory: [] }] }, 'not-found'],
    ['still user-owned', data, 'ready'],
  ])('refreshes authoritative Categories after edit 404 when the id is %s', async (_label, refreshed, expected) => {
    mockParam = '2'
    mockMutate.mockRejectedValue(new ApiError('http', 404))
    mockRead.mockResolvedValue(refreshed)
    const { client, view } = await renderRoute(<CategoryEditRoute />)
    await fireEvent.press(view.getByRole('button', { name: 'Submit category route' }))
    if (expected === 'ready') await waitFor(() => expect(view.getByText('edit:ready:open:none:writable:1')).toBeOnTheScreen())
    else await waitFor(() => expect(view.getByText('edit:not-found:open:not-found:writable:0')).toBeOnTheScreen())
    expect(mockRead).toHaveBeenCalledTimes(1)
    expect(mockMutate).toHaveBeenCalledTimes(1)
    client.clear()
  })

  it('does not infer edit unavailability when the authoritative 404 refresh fails', async () => {
    mockParam = '2'
    mockMutate.mockRejectedValue(new ApiError('http', 404))
    mockRead.mockRejectedValue(new ApiError('network'))
    const { client, view } = await renderRoute(<CategoryEditRoute />)
    await fireEvent.press(view.getByRole('button', { name: 'Submit category route' }))
    await waitFor(() => expect(view.getByText('edit:error:open:not-found:writable:0')).toBeOnTheScreen())
    expect(mockRead).toHaveBeenCalledTimes(1)
    expect(mockMutate).toHaveBeenCalledTimes(1)
    client.clear()
  })
})
