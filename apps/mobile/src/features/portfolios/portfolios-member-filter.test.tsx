import { fireEvent, render, within } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { initMobileI18n } from '@/lib/i18n'

import { PortfoliosRoute } from './portfolios-route'
import type { PortfolioOverviewViewModel } from './portfolios-view-model'

/*
 * The Portfolios tab has one member filter, in its control row beside the period, and the whole
 * tab follows it: the summary and the portfolios (the dashboard), Performance, Allocation,
 * Advanced metrics, Top Movers, Dividend Income and All Holdings each keep the portfolios the
 * chosen member owns, and a former member's under Shared.
 */

jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn(), replace: jest.fn() }) }))
jest.mock('@/components/providers/product-runtime-provider', () => ({ useProductRuntime: () => ({ signOut: jest.fn() }) }))

const overview: PortfolioOverviewViewModel = { assetCount: 2, currency: 'EUR', periodReturn: 12.4, portfolioCount: 1, portfolios: [{ currency: 'EUR', description: null, gainPercent: -3.2, id: 3, name: 'Broker', nativeCurrency: 'USD', value: 120 }], totalGainLoss: -4, totalGainLossPercent: -3.2, totalValue: 120 }
/** Whether the latest render mapped the dashboard as a filtered one. */
const mockMapped: { filtered?: boolean }[] = []
jest.mock('./portfolios-view-model', () => ({
  ...jest.requireActual('./portfolios-view-model'),
  mapPortfolioOverview: (_list: unknown, _dashboard: unknown, filtered?: boolean) => {
    mockMapped.push({ filtered })
    return overview
  },
}))
/** The member each render asked the dashboard (the summary and the portfolios) for. */
const mockDashboardMembers: (string | undefined)[] = []
jest.mock('./use-portfolios', () => ({
  usePortfolios: (_period: string, member?: string) => {
    mockDashboardMembers.push(member)
    return {
      data: { portfolios: { portfolios: [{ portfolioKey: 3 }] }, dashboard: { summary: { currency: 'EUR' } } },
      isAccessTransition: false,
      isInitialLoading: false,
      isInvalidResponse: false,
      isRefreshFailure: false,
      isRefreshing: false,
      refetch: jest.fn(),
    }
  },
}))

/** Every section read the route asks for: its query key (at epoch 1) and the path it reads. */
const mockResources: { key: readonly unknown[]; path: string }[] = []
jest.mock('./use-portfolio-resource', () => ({
  usePortfolioResource: (queryKey: (epochId: number) => readonly unknown[], endpoint: () => { path: string }) => {
    mockResources.push({ key: queryKey(1), path: endpoint().path })
    return { state: { status: 'loading' }, isAccessTransition: false, refetch: jest.fn() }
  },
}))

let mockHouseholdMembers: unknown = null
jest.mock('@/features/household/use-household-members', () => ({
  useHouseholdMembers: () => mockHouseholdMembers ?? jest.requireActual('@/features/household/member-attribution').NO_HOUSEHOLD_MEMBERS,
}))

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
  return render(<I18nextProvider i18n={i18n}><PortfoliosRoute /></I18nextProvider>)
}

/** The latest render's read of every section, by the section it feeds. */
function lastReads() {
  const latest = (match: (key: readonly unknown[]) => boolean) => mockResources.filter((resource) => match(resource.key)).at(-1)
  return {
    performance: latest((key) => key[0] === 'portfolio-performance'),
    allocation: latest((key) => key[0] === 'portfolio-analytics' && key[2] === 'allocation'),
    metrics: latest((key) => key[0] === 'portfolio-analytics' && key[2] === 'metrics'),
    topMovers: latest((key) => key[0] === 'portfolio-top-movers'),
    dividends: latest((key) => key[0] === 'portfolio-analytics' && key[2] === 'dividends'),
    holdings: latest((key) => key[0] === 'portfolio-holdings'),
  }
}

/** The `memberKeys` every section's latest read sent, and each key's last entry. */
function sectionMembers() {
  return Object.entries(lastReads()).map(([section, read]) => {
    expect(read).toBeDefined()
    const memberKeys = new URL(read!.path, 'https://example.test').searchParams.get('memberKeys')
    return { section, memberKeys, keyTail: read!.key.at(-1) }
  })
}

async function choose(view: Awaited<ReturnType<typeof renderRoute>>, name: string) {
  await fireEvent.press(view.getByTestId('member-filter'))
  await fireEvent.press(view.getByRole('radio', { name }))
}

describe('the Portfolios tab, filtered by member', () => {
  beforeEach(() => {
    mockResources.length = 0
    mockDashboardMembers.length = 0
    mockMapped.length = 0
    mockHouseholdMembers = null
  })

  it('offers no member filter in a household of one, and every section shows the household', async () => {
    const view = await renderRoute()

    expect(view.queryByTestId('member-filter')).toBeNull()
    expect(mockDashboardMembers.at(-1)).toBeUndefined()
    expect(sectionMembers().every(({ memberKeys }) => memberKeys === null)).toBe(true)
  })

  it('has one control, beside the period and outside every section', async () => {
    mockHouseholdMembers = twoMemberHousehold()
    const view = await renderRoute()

    expect(view.getAllByTestId('member-filter')).toHaveLength(1)
    expect(within(view.getByTestId('portfolio-performance')).queryByTestId('member-filter')).toBeNull()
    expect(within(view.getByTestId('portfolio-all-holdings')).queryByTestId('member-filter')).toBeNull()
  })

  it('narrows the summary and every section to the chosen member, or to Shared, and back to everyone', async () => {
    mockHouseholdMembers = twoMemberHousehold()
    const view = await renderRoute()
    expect(sectionMembers().every(({ memberKeys }) => memberKeys === null)).toBe(true)

    await choose(view, 'Bruno')
    expect(mockDashboardMembers.at(-1)).toBe('12')
    expect(mockMapped.at(-1)).toEqual({ filtered: true })
    for (const { memberKeys, keyTail } of sectionMembers()) {
      expect(memberKeys).toBe('12')
      // Each member's figures are their own cache entry under the section's key.
      expect(keyTail).toBe('12')
    }
    expect(view.getByRole('button', { name: 'Member: Bruno' })).toBeOnTheScreen()

    await choose(view, 'Shared')
    expect(mockDashboardMembers.at(-1)).toBe('shared')
    expect(sectionMembers().every(({ memberKeys }) => memberKeys === 'shared')).toBe(true)

    await choose(view, 'Everyone')
    expect(mockDashboardMembers.at(-1)).toBeUndefined()
    expect(mockMapped.at(-1)).toEqual({ filtered: false })
    expect(sectionMembers().every(({ memberKeys }) => memberKeys === null)).toBe(true)
    expect(lastReads().performance).toEqual({ key: ['portfolio-performance', 1, 'aggregate', 'YTD'], path: '/v1/portfolio/performance?period=YTD' })
  })
})
