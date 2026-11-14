import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, waitFor } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { initMobileI18n } from '@/lib/i18n'

import { RuleSuggestionPrompt } from './rule-suggestion-prompt'
import { ruleSuggestionSchema } from './rules-contract'

const mockWrite = jest.fn()
jest.mock('@/components/providers/product-runtime-provider', () => ({
  useProductRuntime: () => ({ runtime: { epochId: 4, apiClient: { read: jest.fn(), write: mockWrite } }, blockAccess: jest.fn() }),
}))

const suggestion = ruleSuggestionSchema.parse({
  category: { categoryKey: 9, name: 'GROCERIES' },
  fingerprint: 'd'.repeat(64),
  kind: 'merchant',
  matchCount: 3,
  rule: {
    name: 'Lidl',
    match: 'all',
    stopProcessing: false,
    conditions: [{ field: 'merchant', operator: 'equals', value: 'Lidl' }],
    actions: [{ type: 'set_category', categoryId: 9 }],
  },
  windowDays: 90,
})

const renderPrompt = async () => {
  const i18n = await initMobileI18n('en')
  const onCreate = jest.fn()
  const onClose = jest.fn()
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false, gcTime: 0 } } })
  const view = await render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <RuleSuggestionPrompt categoryName="Groceries" onClose={onClose} onCreate={onCreate} suggestion={suggestion} />
      </I18nextProvider>
    </QueryClientProvider>,
  )
  return { view, onCreate, onClose }
}

describe('RuleSuggestionPrompt', () => {
  beforeEach(() => jest.clearAllMocks())

  it('asks to always categorize transactions like these as the category, by its display name, and says how many', async () => {
    const { view } = await renderPrompt()

    expect(view.getByText(/Groceries/)).toBeOnTheScreen()
    expect(view.getByText(/3 transactions/)).toBeOnTheScreen()
  })

  it('hands the suggestion over to create the rule', async () => {
    const { view, onCreate } = await renderPrompt()

    await fireEvent.press(view.getByRole('button', { name: 'Create rule' }))

    expect(onCreate).toHaveBeenCalledWith(suggestion)
    expect(mockWrite).not.toHaveBeenCalled()
  })

  it('dismisses the suggestion by its fingerprint, then closes', async () => {
    mockWrite.mockResolvedValue(undefined)
    const { view, onClose } = await renderPrompt()

    await fireEvent.press(view.getByRole('button', { name: "Don't suggest again" }))

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(mockWrite).toHaveBeenCalledWith(expect.objectContaining({ method: 'POST', path: '/v1/rule/suggestions/dismiss' }), expect.objectContaining({ body: { fingerprint: suggestion.fingerprint } }))
  })
})
