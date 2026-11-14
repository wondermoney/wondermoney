import { fireEvent, render } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { initMobileI18n } from '@/lib/i18n'

import { BudgetsRoute } from './budgets-route'
import type { BudgetDto } from './budgets-contract'
import { budgetFixture } from './test-fixtures'

/*
 * The member filter on the budgets list (issue #337), by the rule #89 set on web and the API: it
 * narrows what each budget counts and never changes which budgets are listed. The viewer's own
 * personal budget stays in the list whoever they filter by, and shows that member's part of it.
 */

jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn(), replace: jest.fn() }) }))

const personalBudget: BudgetDto = { ...budgetFixture, budgetKey: 8, name: 'My plan', visibility: 'personal' }

/** The member each `useBudgets` call asked for, and what it answers. */
const mockBudgetsCalls: (string | undefined)[] = []
let mockBudgetsData: { budgets: BudgetDto[] } = { budgets: [budgetFixture, personalBudget] }
jest.mock('./use-budgets', () => ({
  useBudgets: (member?: string) => {
    mockBudgetsCalls.push(member)
    return { data: mockBudgetsData, isLoading: false, isRefreshing: false, isRefreshFailure: false, isAccessTransition: false, error: null, refetch: jest.fn() }
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
  return render(<I18nextProvider i18n={i18n}><BudgetsRoute /></I18nextProvider>)
}

const lastMember = () => mockBudgetsCalls.at(-1)

describe('the budgets list member filter', () => {
  beforeEach(() => {
    mockBudgetsCalls.length = 0
    mockHouseholdMembers = null
    mockBudgetsData = { budgets: [budgetFixture, personalBudget] }
  })

  it('offers no member filter in a household of one, and asks for the household\'s budgets', async () => {
    const view = await renderRoute()
    expect(view.queryByTestId('member-filter')).toBeNull()
    expect(lastMember()).toBeUndefined()
  })

  it('narrows each budget to the chosen member, or Shared, and back to everyone', async () => {
    mockHouseholdMembers = twoMemberHousehold()
    const view = await renderRoute()
    expect(lastMember()).toBeUndefined()

    await fireEvent.press(view.getByTestId('member-filter'))
    await fireEvent.press(view.getByRole('radio', { name: 'Bruno' }))
    expect(lastMember()).toBe('12')
    expect(view.getByRole('button', { name: 'Member: Bruno' })).toBeOnTheScreen()

    await fireEvent.press(view.getByTestId('member-filter'))
    await fireEvent.press(view.getByRole('radio', { name: 'Shared' }))
    expect(lastMember()).toBe('shared')

    await fireEvent.press(view.getByTestId('member-filter'))
    await fireEvent.press(view.getByRole('radio', { name: 'Everyone' }))
    expect(lastMember()).toBeUndefined()
  })

  it('keeps the viewer\'s personal budget listed when they filter by another member', async () => {
    mockHouseholdMembers = twoMemberHousehold()
    const view = await renderRoute()
    await fireEvent.press(view.getByTestId('member-filter'))
    await fireEvent.press(view.getByRole('radio', { name: 'Bruno' }))

    expect(lastMember()).toBe('12')
    expect(view.getByText('Household plan')).toBeOnTheScreen()
    expect(view.getByText('My plan')).toBeOnTheScreen()
  })

  it('has no filter to show on an empty list, which no member filter could fill', async () => {
    mockHouseholdMembers = twoMemberHousehold()
    mockBudgetsData = { budgets: [] }
    const view = await renderRoute()
    expect(view.queryByTestId('member-filter')).toBeNull()
  })
})
