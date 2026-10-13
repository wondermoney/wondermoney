import { fireEvent, render, renderHook } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { initMobileI18n } from '@/lib/i18n'

import { mapSankeyReport } from './sankey-report-view-model'
import { SankeyReportScreen } from './sankey-report-screen'
import { useReportFilters } from './use-report-filters'

const filterOptions = { accounts: [], categories: [], merchants: [], currencies: [] }

const renderWithI18n = async (props: Omit<React.ComponentProps<typeof SankeyReportScreen>, 'filterState' | 'filterOptions' | 'exportState' | 'onExport'>) => {
  const i18n = await initMobileI18n('en')
  const filterStateHook = await renderHook(() => useReportFilters())
  return render(
    <I18nextProvider i18n={i18n}>
      <SankeyReportScreen {...props} filterState={filterStateHook.result.current} filterOptions={filterOptions} exportState={{ status: 'idle' }} onExport={jest.fn()} />
    </I18nextProvider>,
  )
}

const report = mapSankeyReport({
  data: {
    nodes: [
      { id: 'salary', label: 'Salary', kind: 'income' },
      { id: 'rent', label: 'Rent', kind: 'expense' },
    ],
    links: [{ source: 'salary', target: 'rent', value: 800 }],
  },
})

describe('SankeyReportScreen', () => {
  it('renders each flow as a labeled source → target row with its value, and the total', async () => {
    const view = await renderWithI18n({ state: { status: 'loaded', report }, preset: 'last3Months', currencyCode: 'EUR', onSelectPreset: jest.fn(), onRefresh: jest.fn(), onBack: jest.fn() })
    expect(view.getByLabelText('Salary → Rent, €800.00')).toBeTruthy()
    expect(view.getByText('Source')).toBeOnTheScreen()
    expect(view.getByText('Target')).toBeOnTheScreen()
    expect(view.getByLabelText('€800.00 total inflow')).toBeTruthy()
  })

  it('shows an honest empty state with no flows', async () => {
    const empty = mapSankeyReport({ data: { nodes: [], links: [] } })
    const view = await renderWithI18n({ state: { status: 'loaded', report: empty }, preset: 'last3Months', currencyCode: 'EUR', onSelectPreset: jest.fn(), onRefresh: jest.fn(), onBack: jest.fn() })
    expect(view.getByText('Not enough activity')).toBeOnTheScreen()
  })

  it('switches presets and renders loading/error states', async () => {
    const onSelectPreset = jest.fn()
    const view = await renderWithI18n({ state: { status: 'loaded', report }, preset: 'last3Months', currencyCode: 'EUR', onSelectPreset, onRefresh: jest.fn(), onBack: jest.fn() })
    await fireEvent.press(view.getByRole('button', { name: 'This month' }))
    expect(onSelectPreset).toHaveBeenCalledWith('thisMonth')

    const loading = await renderWithI18n({ state: { status: 'loading' }, preset: 'last3Months', currencyCode: 'EUR', onSelectPreset: jest.fn(), onRefresh: jest.fn(), onBack: jest.fn() })
    expect(loading.getByRole('progressbar')).toBeOnTheScreen()
  })

  it('shows the export button', async () => {
    const view = await renderWithI18n({ state: { status: 'loaded', report }, preset: 'last3Months', currencyCode: 'EUR', onSelectPreset: jest.fn(), onRefresh: jest.fn(), onBack: jest.fn() })
    expect(view.getByRole('button', { name: 'Export CSV' })).toBeTruthy()
  })
})
