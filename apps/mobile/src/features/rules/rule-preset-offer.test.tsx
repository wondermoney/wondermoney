import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, waitFor } from '@testing-library/react-native'
import { Alert } from 'react-native'
import { I18nextProvider } from 'react-i18next'

import { initMobileI18n } from '@/lib/i18n'

import { RulePresetOffer } from './rule-preset-offer'
import { presetRuleLine, type RulePresetPreview } from './rule-presets-contract'

const mockWrite = jest.fn()
const mockRead = jest.fn()
jest.mock('@/components/providers/product-runtime-provider', () => ({
  useProductRuntime: () => ({ runtime: { epochId: 4, apiClient: { read: mockRead, write: mockWrite } }, blockAccess: jest.fn() }),
}))
jest.mock('expo-localization', () => ({ getLocales: () => [{ languageTag: 'pt-PT', regionCode: 'PT' }] }))

const summary = (code: string, ruleCount: number, installedCount = 0) => ({
  code, countries: ['PT'], language: 'pt', revision: 1, ruleCount, installedCount, installed: installedCount === ruleCount,
})

const out = { field: 'direction', operator: 'is', value: 'out' }
const preview: RulePresetPreview = {
  preset: summary('pt-PT', 2, 1),
  rules: [
    {
      name: 'Continente',
      conditions: [out, { field: 'description', operator: 'contains', value: 'Continente' }],
      actions: [{ type: 'set_category', category: { system: 'GROCERIES' } }, { type: 'set_merchant', merchant: 'Continente' }],
      status: 'installed',
    },
    {
      name: 'EDP Comercial',
      conditions: [out, { field: 'description', operator: 'contains', value: 'EDP Comercial' }],
      actions: [{ type: 'set_category', category: { system: 'ELECTRICITY' } }, { type: 'set_merchant', merchant: 'EDP' }],
      status: 'new',
    },
  ],
}

let list: { presets: ReturnType<typeof summary>[]; suggested: string | null }

const renderOffer = async () => {
  const i18n = await initMobileI18n('en')
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false, gcTime: 0 } } })
  return render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <RulePresetOffer />
      </I18nextProvider>
    </QueryClientProvider>,
  )
}

describe('RulePresetOffer', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    list = { presets: [summary('pt-PT', 2), summary('es-ES', 2)], suggested: 'pt-PT' }
    mockRead.mockImplementation(async (endpoint: { path: string }) => {
      if (endpoint.path.startsWith('/v1/rule/presets?') || endpoint.path === '/v1/rule/presets') return list
      if (endpoint.path === '/v1/rule/presets/pt-PT') return preview
      throw new Error(`unexpected read ${endpoint.path}`)
    })
    mockWrite.mockResolvedValue({ created: ['EDP Comercial'], skipped: ['Continente'] })
  })

  it('offers the preset for the app language and device region, without installing it', async () => {
    const view = await renderOffer()

    await waitFor(() => expect(view.getByText('Start with rules for Portugal')).toBeOnTheScreen())
    expect(mockRead.mock.calls[0]?.[0].path).toBe('/v1/rule/presets?language=en&region=PT')
    expect(mockWrite).not.toHaveBeenCalled()
  })

  it('previews every rule with what it sets, then adds only the new ones on confirm', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined)
    const view = await renderOffer()

    await fireEvent.press(await view.findByRole('button', { name: 'See the rules' }))

    await waitFor(() => expect(view.getByText('EDP Comercial')).toBeOnTheScreen())
    expect(view.getByText('Description contains “EDP Comercial”')).toBeOnTheScreen()
    expect(view.getByText('Groceries · Merchant: Continente · Already added')).toBeOnTheScreen()
    expect(mockWrite).not.toHaveBeenCalled()

    await fireEvent.press(view.getByRole('button', { name: 'Add 1 rule' }))

    await waitFor(() => expect(alert).toHaveBeenCalledWith('1 rule added'))
    expect(mockWrite).toHaveBeenCalledTimes(1)
    expect(mockWrite.mock.calls[0]?.[0]).toMatchObject({ method: 'POST', path: '/v1/rule/presets/pt-PT/install' })
  })

  it('stays quiet once any of the preset is installed, or when none matches', async () => {
    list = { presets: [summary('pt-PT', 2, 1)], suggested: 'pt-PT' }
    const installed = await renderOffer()
    await waitFor(() => expect(mockRead).toHaveBeenCalled())
    expect(installed.queryByText('Start with rules for Portugal')).not.toBeOnTheScreen()
    installed.unmount()

    list = { presets: [summary('pt-PT', 2)], suggested: null }
    const none = await renderOffer()
    await waitFor(() => expect(mockRead).toHaveBeenCalledTimes(2))
    expect(none.queryByRole('button', { name: 'See the rules' })).not.toBeOnTheScreen()
  })

  it('goes away after Not now', async () => {
    const view = await renderOffer()

    await fireEvent.press(await view.findByRole('button', { name: 'Not now' }))

    expect(view.queryByText('Start with rules for Portugal')).not.toBeOnTheScreen()
  })
})

describe('presetRuleLine', () => {
  it('reads what a rule looks for, what it excludes and what it sets', () => {
    expect(presetRuleLine({
      name: 'Tesco',
      conditions: [out, { field: 'description', operator: 'contains', value: 'Tesco' }, { field: 'description', operator: 'not_contains', value: 'Bank' }],
      actions: [{ type: 'set_category', category: { system: 'GROCERIES' } }, { type: 'set_merchant', merchant: 'Tesco' }],
      status: 'new',
    })).toEqual({ name: 'Tesco', matches: ['Tesco'], excludes: ['Bank'], category: 'GROCERIES', merchant: 'Tesco', status: 'new' })
  })
})
