import { fireEvent, render } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { ApiError } from '@/lib/api/errors'
import { initMobileI18n } from '@/lib/i18n'

import { PortfolioPerformanceReportRoute } from './portfolio-performance-report-route'

const mockReplace = jest.fn()
const mockRefetch = jest.fn()

const responseData = {
  data: [{ portfolioKey: '7', name: 'Long-term', currency: 'EUR', startValue: 1000, netContributions: 0, change: 100, changePercent: 10, dividends: 0, endValue: 1100 }],
  generatedAt: '2026-08-11T00:00:00.000Z',
  filters: {},
}

let mockQuery: { data?: unknown; isLoading: boolean; isFetching: boolean; isAccessTransition: boolean; error: unknown; refetch: jest.Mock } = {
  data: responseData, isLoading: false, isFetching: false, isAccessTransition: false, error: null, refetch: mockRefetch,
}

jest.mock('expo-router', () => ({ useRouter: () => ({ replace: mockReplace }) }))
jest.mock('./use-portfolio-performance-report', () => ({ usePortfolioPerformanceReport: (...args: unknown[]) => mockUsePortfolioPerformanceReport(...args) }))
jest.mock('./use-reports-currency', () => ({ useReportsCurrency: () => 'EUR' }))
jest.mock('./use-report-export', () => ({ useReportExport: (...args: unknown[]) => mockUseReportExport(...args) }))
let mockHouseholdMembers: unknown = null
jest.mock('@/features/household/use-household-members', () => ({
  useHouseholdMembers: () => mockHouseholdMembers ?? jest.requireActual('@/features/household/member-attribution').NO_HOUSEHOLD_MEMBERS,
}))

const mockUsePortfolioPerformanceReport = jest.fn((..._args: unknown[]) => mockQuery)
const mockUseReportExport = jest.fn((..._args: unknown[]) => ({ state: { status: 'idle' }, exportCsv: jest.fn() }))

/** The filters the report (and its CSV export) was last asked for. */
const lastReportFilters = () => mockUsePortfolioPerformanceReport.mock.calls.at(-1)?.[0] as { memberKeys?: readonly string[] }
const lastExportFilters = () => mockUseReportExport.mock.calls.at(-1)?.[1] as { memberKeys?: readonly string[] }

function twoMemberHousehold() {
  const { householdMembersModel } = jest.requireActual<typeof import('@/features/household/member-attribution')>('@/features/household/member-attribution')
  return householdMembersModel({
    members: [
      { appuserKey: 11, emailAddress: 'ana@example.test', firstName: 'Ana', role: 'owner' },
      { appuserKey: 12, emailAddress: 'bruno@example.test', firstName: 'Bruno', role: 'member' },
    ],
    maxMembers: 6,
    pendingInvites: [],
    viewerAppuserKey: 11,
  })
}

async function renderRoute() {
  const i18n = await initMobileI18n('en')
  return render(<I18nextProvider i18n={i18n}><PortfolioPerformanceReportRoute /></I18nextProvider>)
}

describe('PortfolioPerformanceReportRoute', () => {
  beforeEach(() => {
    mockReplace.mockReset()
    mockRefetch.mockReset()
    mockQuery = { data: responseData, isLoading: false, isFetching: false, isAccessTransition: false, error: null, refetch: mockRefetch }
    mockHouseholdMembers = null
    mockUsePortfolioPerformanceReport.mockClear()
    mockUseReportExport.mockClear()
  })

  it('offers no member filter in a household of one, and asks for the household\'s portfolios', async () => {
    const view = await renderRoute()
    expect(view.queryByTestId('member-filter')).toBeNull()
    expect(lastReportFilters().memberKeys).toBeUndefined()
  })

  it('narrows the report and its export to the chosen member, or to Shared', async () => {
    mockHouseholdMembers = twoMemberHousehold()
    const view = await renderRoute()
    expect(lastReportFilters().memberKeys).toBeUndefined()

    await fireEvent.press(view.getByTestId('member-filter'))
    await fireEvent.press(view.getByRole('radio', { name: 'Bruno' }))
    expect(lastReportFilters().memberKeys).toEqual(['12'])
    expect(lastExportFilters().memberKeys).toEqual(['12'])
    expect(view.getByRole('button', { name: 'Member: Bruno' })).toBeOnTheScreen()

    await fireEvent.press(view.getByTestId('member-filter'))
    await fireEvent.press(view.getByRole('radio', { name: 'Shared' }))
    expect(lastReportFilters().memberKeys).toEqual(['shared'])

    await fireEvent.press(view.getByTestId('member-filter'))
    await fireEvent.press(view.getByRole('radio', { name: 'Everyone' }))
    expect(lastReportFilters().memberKeys).toBeUndefined()
  })

  it('maps a loaded response into the screen', async () => {
    const view = await renderRoute()
    expect(view.getByText('Long-term')).toBeOnTheScreen()
  })

  it('surfaces invalid-response distinctly and navigates back to the reports hub', async () => {
    mockQuery = { ...mockQuery, data: undefined, error: new ApiError('invalid-response') }
    const view = await renderRoute()
    expect(view.getByText('The report data received could not be verified')).toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Back' }))
    expect(mockReplace).toHaveBeenCalledWith('/reports')
  })
})
