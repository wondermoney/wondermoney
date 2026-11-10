import { fireEvent, render, within } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'
import { StyleSheet } from 'react-native'

import { initMobileI18n } from '@/lib/i18n'

import { goalsResponseSchema } from './goals-contract'
import { GoalsScreen, type GoalsData } from './goals-screen'
import { mapGoalListItem, mapGoals } from './goals-view-model'
import { goalFixture } from './test-fixtures'

const data: GoalsData = {
  goals: [
    mapGoalListItem(goalFixture),
    mapGoalListItem({
      ...goalFixture,
      goalKey: 4,
      name: 'Japan reserve',
      currencyCode: 'JPY',
      targetAmount: 0,
      monthlyContributionTarget: null,
      targetDate: null,
      status: 'paused',
      summary: {
        ...goalFixture.summary,
        availableAmount: 0,
        progressPercentage: 100,
        remainingToTarget: 0,
        status: 'funded',
      },
    }),
    mapGoalListItem({
      ...goalFixture,
      goalKey: 5,
      name: 'Dollar reserve',
      currencyCode: 'USD',
      targetAmount: 200,
      monthlyContributionTarget: 0,
      targetDate: null,
      summary: { ...goalFixture.summary, availableAmount: 250, progressPercentage: 125, remainingToTarget: 0 },
    }),
  ],
}

async function renderScreen(
  state: React.ComponentProps<typeof GoalsScreen>['state'],
  locale = 'en',
  createBlocked = false,
  activeView: 'active' | 'archived' = 'active',
) {
  const i18n = await initMobileI18n(locale)
  const refresh = jest.fn()
  const logout = jest.fn()
  const viewGoal = jest.fn()
  const createGoal = jest.fn()
  const viewDebtStrategy = jest.fn()
  const selectView = jest.fn()
  const restoreGoal = jest.fn()
  const restorePending = jest.fn(() => false)
  const view = await render(
    <I18nextProvider i18n={i18n}>
      <GoalsScreen
        state={state}
        view={activeView}
        onSelectView={selectView}
        onRefresh={refresh}
        onLogout={logout}
        onViewGoal={viewGoal}
        onCreateGoal={createGoal}
        onViewDebtStrategy={viewDebtStrategy}
        createBlocked={createBlocked}
        onRestoreGoal={restoreGoal}
        restorePending={restorePending}
      />
    </I18nextProvider>,
  )
  return { view, refresh, logout, viewGoal, createGoal, viewDebtStrategy, selectView, restoreGoal, restorePending }
}

describe('GoalsScreen', () => {
  it('shows the goal ledger in order, each row with its status chip, figure, target and percentage', async () => {
    const { view } = await renderScreen({ status: 'loaded', data })
    const rows = view.getAllByTestId('goal-row')
    expect(rows).toHaveLength(3)
    expect(within(rows[0]).getByText('Emergency reserve')).toBeOnTheScreen()
    expect(within(rows[1]).getByText('Japan reserve')).toBeOnTheScreen()
    expect(within(rows[2]).getByText('Dollar reserve')).toBeOnTheScreen()
    expect(within(rows[0]).getByText('Active')).toBeOnTheScreen()
    expect(within(rows[1]).getByText('Paused')).toBeOnTheScreen()
    expect(within(rows[0]).getByText('of €1,000.00')).toBeOnTheScreen()
    expect(within(rows[0]).getByText('60%')).toBeOnTheScreen()
    expect(view.getByLabelText(/Emergency reserve.*Active.*Available, €600\.00.*of €1,000\.00.*60%/)).toBeOnTheScreen()
    // Web clamps the bar and the figure to 100%.
    expect(within(rows[2]).getByText('100%')).toBeOnTheScreen()
    expect(StyleSheet.flatten(view.getByTestId('goal-progress-fill-5').props.style).width).toBe('100%')
    expect(view.queryAllByRole('link')).toHaveLength(0)
  })

  it('leads with Funded of the target, then Target and Active, and does not sum goals held in different currencies', async () => {
    const single = await renderScreen({ status: 'loaded', data: { goals: [data.goals[0]] } })
    const summary = single.view.getByTestId('goals-summary')
    expect(within(summary).getByText('Target')).toBeOnTheScreen()
    expect(within(summary).getByText('€1,000.00')).toBeOnTheScreen()
    expect(within(summary).getByText('€800.00')).toBeOnTheScreen()
    expect(within(summary).getByText('of €1,000.00')).toBeOnTheScreen()
    // Funded is the one headline; Target and Active follow it as columns.
    const labels = within(summary).getAllByText(/^(Funded|Target|Active)$/).map((node) => node.props.children)
    expect(labels).toEqual(['Funded', 'Target', 'Active'])

    const mixed = await renderScreen({ status: 'loaded', data })
    const mixedSummary = mixed.view.getByTestId('goals-summary')
    expect(within(mixedSummary).getByText('Goals')).toBeOnTheScreen()
    expect(within(mixedSummary).getAllByText('3')).toHaveLength(2)
    expect(within(mixedSummary).queryByText(/€/)).not.toBeOnTheScreen()
  })

  it('shows a debt goal with its remaining balance, chip and payoff date', async () => {
    const debt = mapGoalListItem({
      ...goalFixture,
      type: 'debt_paydown',
      summary: { ...goalFixture.summary, debtProjection: { currentBalance: 9017.06, monthlyPayment: 250, months: 29, payoffDate: '2029-04-01T00:00:00.000Z', paysOff: true, progressPercentage: 0, totalInterest: 400 } },
    })
    const { view } = await renderScreen({ status: 'loaded', data: { goals: [debt] } })
    const row = view.getByTestId('goal-row')
    expect(within(row).getByText('Pay off debt')).toBeOnTheScreen()
    expect(within(row).getByText('Remaining')).toBeOnTheScreen()
    expect(within(row).getByText('Payoff by Apr 1, 2029')).toBeOnTheScreen()
  })

  it('does not aggregate goals or expose unrelated write, premium, or bank-transfer language', async () => {
    const { view } = await renderScreen({ status: 'loaded', data })
    expect(view.getByRole('button', { name: 'Create goal' })).toBeOnTheScreen()
    expect(view.queryByText(/add|edit|delete|premium|upgrade|bank transfer|transfer|transaction/i)).not.toBeOnTheScreen()
    expect(view.queryByRole('image')).not.toBeOnTheScreen()
  })

  it('keeps the on-track caveat off the card and, like web, has no help hint beside the title', async () => {
    const onTrack = mapGoalListItem({
      ...goalFixture,
      summary: { ...goalFixture.summary, status: 'on_track', monthlyShortfall: null },
    })
    const { view } = await renderScreen({ status: 'loaded', data: { goals: [onTrack] } })
    expect(view.queryByText(/not a guarantee/)).not.toBeOnTheScreen()
    expect(view.queryByRole('button', { name: /On track means no calculable shortfall/ })).not.toBeOnTheScreen()
    expect(view.queryByText('Help')).not.toBeOnTheScreen()
  })

  it('formats progress with the active locale', async () => {
    const localized = mapGoalListItem({
      ...goalFixture,
      summary: { ...goalFixture.summary, availableAmount: 125, progressPercentage: 99 },
    })
    const { view } = await renderScreen({ status: 'loaded', data: { goals: [localized] } }, 'pt-PT')

    expect(view.getByText('99%')).toBeOnTheScreen()
    expect(view.getAllByText('de 1000,00 €').length).toBeGreaterThan(0)
  })

  it('renders planning-reserve context, locale-aware preview data, and the deliberate create entry point when empty', async () => {
    const { view } = await renderScreen({ status: 'loaded', data: { goals: [] } })
    expect(view.getByText('Give your money a purpose')).toBeOnTheScreen()
    expect(view.getByText('Emergency fund')).toBeOnTheScreen()
    expect(view.getByText('€2,400.00')).toBeOnTheScreen()
    expect(view.getByText('€6,000.00')).toBeOnTheScreen()
    expect(view.getAllByText('40%')).toHaveLength(2)
    expect(view.getAllByRole('button', { name: 'Create goal' })).toHaveLength(1)
    expect(view.getByText('Vacation')).toBeOnTheScreen()
    expect(view.getByText('€850.00')).toBeOnTheScreen()
    expect(view.getByText('€2,000.00')).toBeOnTheScreen()
    expect(view.getByText('43%')).toBeOnTheScreen()
    expect(view.getByText('Taxes')).toBeOnTheScreen()
    expect(view.getByRole('button', { name: 'Create goal' })).toBeOnTheScreen()
  })

  it('shows the epoch unknown banner and disables another create', async () => {
    const { view, createGoal } = await renderScreen({ status: 'loaded', data }, 'en', true)
    expect(view.getByRole('alert', { name: /Goal creation outcome unknown/ })).toBeOnTheScreen()
    expect(view.getByRole('button', { name: 'Create goal' })).toBeDisabled()
    await fireEvent.press(view.getByRole('button', { name: 'Create goal' }))
    expect(createGoal).not.toHaveBeenCalled()
  })

  it('opens the goal from the whole row, as web does', async () => {
    const { view, viewGoal } = await renderScreen({ status: 'loaded', data: { goals: [data.goals[0]] } })
    const row = view.getByTestId('goal-row')
    expect(row.props.accessibilityRole).toBe('button')
    expect(within(row).queryAllByRole('button')).toHaveLength(0)
    await fireEvent.press(row)
    expect(viewGoal).toHaveBeenCalledWith(3)
  })

  it('handles loading, stale, errors, invalid response, and access transition safely', async () => {
    const loading = await renderScreen({ status: 'loading' })
    expect(loading.view.getByRole('progressbar', { name: 'Loading goals' })).toBeOnTheScreen()

    const stale = await renderScreen({ status: 'refresh-error', data })
    expect(stale.view.getByRole('alert', { name: 'Could not refresh. Showing previously loaded goals' })).toBeOnTheScreen()
    expect(stale.view.getByText('Emergency reserve')).toBeOnTheScreen()

    for (const status of ['error', 'invalid-response'] as const) {
      const failed = await renderScreen({ status })
      expect(failed.view.queryByText('Emergency reserve')).not.toBeOnTheScreen()
      await fireEvent.press(failed.view.getByRole('button', { name: 'Retry' }))
      await fireEvent.press(failed.view.getByRole('button', { name: 'Sign out' }))
      expect(failed.refresh).toHaveBeenCalledTimes(1)
      expect(failed.logout).toHaveBeenCalledTimes(1)
    }

    const access = await renderScreen({ status: 'access-transition' })
    expect(access.view.toJSON()).toBeNull()
  })

  it('keeps sign-out out of the primary dashboard, matching the web account menu', async () => {
    const { view } = await renderScreen({ status: 'loaded', data: { goals: [] } })
    expect(view.queryByRole('button', { name: 'Sign out' })).not.toBeOnTheScreen()
  })

  it('keeps pull-to-refresh available without a persistent refresh button', async () => {
    const { view } = await renderScreen({ status: 'loaded', data })
    expect(view.queryByRole('button', { name: 'Refresh' })).not.toBeOnTheScreen()
  })

  describe('archived goals tab', () => {
    it('shows an Active/Archived toggle and switches views on selection', async () => {
      const { view, selectView } = await renderScreen({ status: 'loaded', data })
      expect(view.getByRole('tab', { name: 'Active' }).props.accessibilityState.selected).toBe(true)
      expect(view.getByRole('tab', { name: 'Archived' }).props.accessibilityState.selected).toBe(false)
      await fireEvent.press(view.getByRole('tab', { name: 'Archived' }))
      expect(selectView).toHaveBeenCalledWith('archived')
    })

    it('shows a distinct empty state and no create-goal restriction on the archived tab', async () => {
      const { view } = await renderScreen({ status: 'loaded', data: { goals: [] } }, 'en', false, 'archived')
      expect(view.getByText('No archived goals.')).toBeOnTheScreen()
      expect(view.getByRole('button', { name: 'Create goal' })).toBeOnTheScreen()
    })

    it('dims each archived row and restores it inline without navigating away', async () => {
      const archivedData: GoalsData = { goals: [mapGoalListItem({ ...goalFixture, status: 'archived' })] }
      const { view, restoreGoal, viewGoal } = await renderScreen({ status: 'loaded', data: archivedData }, 'en', false, 'archived')
      expect(StyleSheet.flatten(view.getByTestId('goal-row-dimmed').props.style).opacity).toBeLessThan(1)
      await fireEvent.press(view.getByRole('button', { name: 'Restore' }))
      expect(restoreGoal).toHaveBeenCalledWith(goalFixture.goalKey)
      expect(viewGoal).not.toHaveBeenCalled()
    })

    it('locks the restore action for a goal while its restore is pending', async () => {
      const archivedData: GoalsData = { goals: [mapGoalListItem({ ...goalFixture, status: 'archived' })] }
      const restorePending = jest.fn(() => true)
      const i18n = await initMobileI18n('en')
      const view = await render(
        <I18nextProvider i18n={i18n}>
          <GoalsScreen
            state={{ status: 'loaded', data: archivedData }}
            view="archived"
            onSelectView={jest.fn()}
            onRefresh={jest.fn()}
            onLogout={jest.fn()}
            onViewGoal={jest.fn()}
            onCreateGoal={jest.fn()}
            onViewDebtStrategy={jest.fn()}
            createBlocked={false}
            onRestoreGoal={jest.fn()}
            restorePending={restorePending}
          />
        </I18nextProvider>,
      )
      expect(view.getByRole('button', { name: 'Restoring…' }).props.accessibilityState.disabled).toBe(true)
    })

    it('never shows a restore action on the active tab', async () => {
      const { view } = await renderScreen({ status: 'loaded', data })
      expect(view.queryByRole('button', { name: /restore/i })).not.toBeOnTheScreen()
    })
  })

  it('offers the debt payoff strategy only once there are two debts to compare, as web does', async () => {
    const debt = (goalKey: number) => mapGoalListItem({ ...goalFixture, goalKey, type: 'debt_paydown' })
    const none = await renderScreen({ status: 'loaded', data })
    expect(none.view.queryByRole('button', { name: 'Debt payoff strategy' })).not.toBeOnTheScreen()

    const { view, viewDebtStrategy } = await renderScreen({ status: 'loaded', data: { goals: [debt(1), debt(2)] } })
    fireEvent.press(view.getByRole('button', { name: 'Debt payoff strategy' }))
    expect(viewDebtStrategy).toHaveBeenCalled()
  })
})

describe('GoalsScreen with values this build does not know', () => {
  it('renders a goal whose status is new to this build alongside known goals', async () => {
    const response = goalsResponseSchema.parse({ goals: [{ ...goalFixture, goalKey: 9, name: 'Frozen goal', status: 'frozen', extra: true }, goalFixture] })
    const { view } = await renderScreen({ status: 'loaded', data: { goals: mapGoals(response) } })
    expect(view.getByText('Frozen goal')).toBeOnTheScreen()
    expect(view.getByText('Status unavailable')).toBeOnTheScreen()
    expect(view.getByText(goalFixture.name)).toBeOnTheScreen()
  })
})
