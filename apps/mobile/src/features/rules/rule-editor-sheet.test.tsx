import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, waitFor } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { initMobileI18n } from '@/lib/i18n'

import { RuleEditorSheet } from './rule-editor-sheet'
import { ruleSchema } from './rules-contract'
import { seedRuleFromTransaction } from './rules-view-model'

const mockWrite = jest.fn()
jest.mock('@/components/providers/product-runtime-provider', () => ({
  useProductRuntime: () => ({ runtime: { epochId: 4, apiClient: { read: jest.fn(), write: mockWrite } }, blockAccess: jest.fn() }),
}))

const savedRule = ruleSchema.parse({
  ruleKey: 11,
  name: 'Corner shop',
  active: true,
  match: 'all',
  stopProcessing: false,
  conditions: [{ field: 'merchant', operator: 'equals', value: 'Corner shop' }],
  actions: [{ type: 'set_category', categoryId: 9 }],
  position: 0,
  ownerAppuserKey: 2,
})

const renderSheet = async (props: { rule?: ReturnType<typeof ruleSchema.parse> | null; seed?: ReturnType<typeof seedRuleFromTransaction> | null; onSaved?: (rule: unknown) => void }) => {
  const i18n = await initMobileI18n('en')
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false, gcTime: 0 } } })
  const view = await render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <RuleEditorSheet
          categories={[{ id: 9, name: 'Groceries' }]}
          onClose={jest.fn()}
          onSaved={props.onSaved ?? jest.fn()}
          rule={props.rule ?? null}
          seed={props.seed ?? null}
          visible
        />
      </I18nextProvider>
    </QueryClientProvider>,
  )
  return { view, client }
}

const bodyOf = (path: string) => {
  const call = mockWrite.mock.calls.find(([endpoint]) => endpoint.path === path)
  return call?.[1]?.body
}

describe('RuleEditorSheet', () => {
  beforeEach(() => jest.clearAllMocks())

  it('pre-fills a rule from a transaction, shows the preview count and saves only the supported fields', async () => {
    mockWrite.mockImplementation(async (endpoint: { path: string }) => {
      if (endpoint.path === '/v1/rule/preview') return { matchCount: 3, changeCount: 2, transactions: [] }
      if (endpoint.path === '/v1/rule') return { rule: savedRule }
      throw new Error(`unexpected ${endpoint.path}`)
    })
    const onSaved = jest.fn()
    const { view } = await renderSheet({
      seed: seedRuleFromTransaction({ merchant: 'Corner shop', description: 'CARD PURCHASE', categoryId: 9 }),
      onSaved,
    })

    await waitFor(() => expect(view.getByText('3 transactions match · 2 would change')).toBeOnTheScreen())
    expect(bodyOf('/v1/rule/preview')).toEqual({
      match: 'all',
      conditions: [{ field: 'merchant', operator: 'equals', value: 'Corner shop' }],
      actions: [{ type: 'set_category', categoryId: 9 }],
    })

    await fireEvent.press(view.getByTestId('rule-editor-save'))
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(savedRule))
    expect(bodyOf('/v1/rule')).toEqual({
      name: 'Corner shop',
      match: 'all',
      conditions: [{ field: 'merchant', operator: 'equals', value: 'Corner shop' }],
      actions: [{ type: 'set_category', categoryId: 9 }],
    })
  })

  it('edits a supported rule and keeps a merchant saved by id', async () => {
    mockWrite.mockImplementation(async (endpoint: { path: string }) => {
      if (endpoint.path === '/v1/rule/preview') return { matchCount: 0, changeCount: 0, transactions: [] }
      if (endpoint.path === '/v1/rule/4') return { rule: savedRule }
      throw new Error(`unexpected ${endpoint.path}`)
    })
    const rule = ruleSchema.parse({
      ...savedRule,
      ruleKey: 4,
      conditions: [{ field: 'description', operator: 'contains', source: 'cleaned', value: 'CARD' }],
      actions: [{ type: 'set_merchant', merchantId: 5 }],
    })
    const { view } = await renderSheet({ rule })

    await fireEvent.press(view.getByTestId('rule-editor-save'))
    await waitFor(() => expect(bodyOf('/v1/rule/4')).toBeDefined())
    expect(bodyOf('/v1/rule/4')).toEqual({
      name: 'Corner shop',
      match: 'all',
      conditions: [{ field: 'description', operator: 'contains', source: 'cleaned', value: 'CARD' }],
      actions: [{ type: 'set_merchant', merchantId: 5 }],
    })
  })

  it('opens a rule outside the subset read-only, with no way to save it', async () => {
    const rule = ruleSchema.parse({
      ...savedRule,
      conditions: [{ field: 'account', operator: 'in', values: [1] }],
    })
    const { view } = await renderSheet({ rule })

    expect(view.getByText("This rule can't be edited here")).toBeOnTheScreen()
    expect(view.getByText("It uses fields the app doesn't edit yet. Open the web app to change it.")).toBeOnTheScreen()
    expect(view.queryByTestId('rule-editor-save')).toBeNull()
    expect(mockWrite).not.toHaveBeenCalled()
  })

  it('does not call the API for an incomplete rule and says what is missing', async () => {
    const { view } = await renderSheet({
      seed: seedRuleFromTransaction({ merchant: 'Corner shop', description: null, categoryId: null }),
    })

    await fireEvent.press(view.getByTestId('rule-editor-save'))

    expect(view.getByText('Choose a category.')).toBeOnTheScreen()
    expect(mockWrite).not.toHaveBeenCalled()
  })
})
