import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, waitFor } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { ApiError } from '@/lib/api/errors'
import { initMobileI18n } from '@/lib/i18n'

import { RuleApplyOffer } from './rule-apply-offer'
import { ruleSchema } from './rules-contract'

const mockWrite = jest.fn()
const mockRead = jest.fn()
jest.mock('@/components/providers/product-runtime-provider', () => ({
  useProductRuntime: () => ({ runtime: { epochId: 4, apiClient: { read: mockRead, write: mockWrite } }, blockAccess: jest.fn() }),
}))

const rule = ruleSchema.parse({
  ruleKey: 4,
  name: 'Netflix',
  active: true,
  match: 'all',
  stopProcessing: false,
  conditions: [{ field: 'description', operator: 'contains', source: 'cleaned', value: 'NETFLIX' }],
  actions: [{ type: 'set_category', categoryId: 9 }],
  position: 0,
  ownerAppuserKey: 2,
})

const renderOffer = async (onClose = jest.fn(), onApplied = jest.fn()) => {
  const i18n = await initMobileI18n('en')
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false, gcTime: 0 } } })
  const view = await render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <RuleApplyOffer onApplied={onApplied} onClose={onClose} rule={rule} />
      </I18nextProvider>
    </QueryClientProvider>,
  )
  return { view, onClose, onApplied }
}

describe('RuleApplyOffer', () => {
  beforeEach(() => jest.clearAllMocks())

  it('counts what would change, applies on confirm, and reports how many changed', async () => {
    mockWrite.mockImplementation(async (_endpoint: { path: string }, options: { body: { dryRun: boolean } }) => (
      options.body.dryRun ? { changeCount: 3 } : { operationId: 'rule.apply:1' }
    ))
    mockRead.mockResolvedValue({ status: 'succeeded', progress: { changed: 3, processed: 10, total: 10 } })
    const { view, onApplied } = await renderOffer()

    await waitFor(() => expect(view.getByText('3 existing transactions would change.')).toBeOnTheScreen())
    await fireEvent.press(view.getByRole('button', { name: 'Apply to 3 transactions' }))

    await waitFor(() => expect(view.getByText('Done: 3 transactions changed')).toBeOnTheScreen())
    expect(mockWrite).toHaveBeenCalledWith(expect.objectContaining({ path: '/v1/rule/4/apply' }), expect.objectContaining({ body: { dryRun: false } }))
    expect(mockRead).toHaveBeenCalledWith(expect.objectContaining({ path: '/v1/operations/rule.apply%3A1' }))
    expect(onApplied).toHaveBeenCalled()
  })

  it('stays out of the way when no existing transaction would change', async () => {
    mockWrite.mockResolvedValue({ changeCount: 0 })
    const { view, onClose } = await renderOffer()

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(view.queryByText('Apply to 0 transactions')).not.toBeOnTheScreen()
    expect(view.queryByRole('button', { name: 'Not now' })).not.toBeOnTheScreen()
  })

  it('says when another run is already going', async () => {
    mockWrite.mockImplementation(async (_endpoint: { path: string }, options: { body: { dryRun: boolean } }) => {
      if (options.body.dryRun) return { changeCount: 2 }
      throw new ApiError('http', 409)
    })
    const { view } = await renderOffer()

    await waitFor(() => expect(view.getByText('2 existing transactions would change.')).toBeOnTheScreen())
    await fireEvent.press(view.getByRole('button', { name: 'Apply to 2 transactions' }))
    await waitFor(() => expect(view.getByText('Rules are already being applied. Wait for that to finish, then try again.')).toBeOnTheScreen())
  })
})
