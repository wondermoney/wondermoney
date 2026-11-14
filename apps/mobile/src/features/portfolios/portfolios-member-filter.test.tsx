import { fireEvent, render, within } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { initMobileI18n } from '@/lib/i18n'

import { PortfoliosRoute } from './portfolios-route'
import type { PortfolioOverviewViewModel } from './portfolios-view-model'

/*
 * The Portfolios tab's Performance chart follows the member filter, by the rule the portfolio
 * performance report and net worth follow: it keeps the portfolios that member owns, and a former
 * member's under Shared. The control sits on the chart's section, because the tab's other figures
 * stay the household's.
 */

jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn(), replace: jest.fn() }) }))
jest.mock('@/components/providers/product-runtime-provider', () => ({ useProductRuntime: () => ({ signOut: jest.fn() }) }))

const overview: PortfolioOverviewViewModel = { assetCount: 2, currency: 'EUR', periodReturn: 12.4, portfolioCount: 1, portfolios: [{ currency: 'EUR', description: null, gainPercent: -3.2, id: 3, name: 'Broker', nativeCurrency: 'USD', value: 120 }], totalGainLoss: -4, totalGainLossPercent: -3.2, totalValue: 120 }
jest.mock('./portfolios-view-model', () => ({
  ...jest.requireActual('./portfolios-view-model'),
  mapPortfolioOverview: () => overview,
}))
jest.mock('./use-portfolios', () => ({
  usePortfolios: () => ({
    data: { portfolios: { portfolios: [{ portfolioKey: 3 }] }, dashboard: { summary: { currency: 'EUR' } } },
    isAccessTransition: false,
    isInitialLoading: false,
    isInvalidResponse: false,
    isRefreshFailure: false,
    isRefreshing: false,
    refetch: jest.fn(),
  }),
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

/** The latest render's read of one section, by its query key's tag. */
const lastRead = (tag: string) => mockResources.filter((resource) => resource.key[0] === tag).at(-1)

describe('the Portfolios tab chart, filtered by member', () => {
  beforeEach(() => {
    mockResources.length = 0
    mockHouseholdMembers = null
  })

  it('offers no member filter in a household of one, and charts the household\'s portfolios', async () => {
    const view = await renderRoute()
    expect(view.queryByTestId('member-filter')).toBeNull()
    expect(lastRead('portfolio-performance')?.path).toBe('/v1/portfolio/performance?period=YTD')
  })

  it('narrows the chart to the chosen member, or to Shared, and back to everyone', async () => {
    mockHouseholdMembers = twoMemberHousehold()
    const view = await renderRoute()
    // The control is on the Performance section, beside its heading.
    const section = view.getByTestId('portfolio-performance')
    expect(within(section).getByTestId('member-filter')).toBeOnTheScreen()
    expect(lastRead('portfolio-performance')?.path).toBe('/v1/portfolio/performance?period=YTD')

    await fireEvent.press(view.getByTestId('member-filter'))
    await fireEvent.press(view.getByRole('radio', { name: 'Bruno' }))
    expect(lastRead('portfolio-performance')).toEqual({ key: ['portfolio-performance', 1, 'aggregate', 'YTD', '12'], path: '/v1/portfolio/performance?period=YTD&memberKeys=12' })
    expect(view.getByRole('button', { name: 'Member: Bruno' })).toBeOnTheScreen()

    await fireEvent.press(view.getByTestId('member-filter'))
    await fireEvent.press(view.getByRole('radio', { name: 'Shared' }))
    expect(lastRead('portfolio-performance')?.path).toBe('/v1/portfolio/performance?period=YTD&memberKeys=shared')

    await fireEvent.press(view.getByTestId('member-filter'))
    await fireEvent.press(view.getByRole('radio', { name: 'Everyone' }))
    expect(lastRead('portfolio-performance')).toEqual({ key: ['portfolio-performance', 1, 'aggregate', 'YTD'], path: '/v1/portfolio/performance?period=YTD' })
  })

  it('leaves the tab\'s other sections the household\'s', async () => {
    mockHouseholdMembers = twoMemberHousehold()
    const view = await renderRoute()
    const before = ['portfolio-top-movers', 'portfolio-analytics', 'portfolio-holdings'].map((tag) => lastRead(tag)?.path)

    await fireEvent.press(view.getByTestId('member-filter'))
    await fireEvent.press(view.getByRole('radio', { name: 'Bruno' }))

    expect(['portfolio-top-movers', 'portfolio-analytics', 'portfolio-holdings'].map((tag) => lastRead(tag)?.path)).toEqual(before)
    expect(before.every((path) => path !== undefined && !path.includes('memberKeys'))).toBe(true)
  })
})
