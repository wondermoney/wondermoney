import { fireEvent, render, within } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'
import { StyleSheet } from 'react-native'

import { initMobileI18n } from '@/lib/i18n'

import { GoalsScreen, type GoalsData } from './goals-screen'
import { mapGoalListItem } from './goals-view-model'
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
  it('shows ordered non-interactive goal rows with locale currency and complete comparisons', async () => {
    const { view } = await renderScreen({ status: 'loaded', data })
    const rows = view.getAllByTestId('goal-row')
    expect(rows).toHaveLength(3)
    expect(within(rows[0]).getByText('Emergency reserve')).toBeOnTheScreen()
    expect(within(rows[1]).getByText('Japan reserve')).toBeOnTheScreen()
    expect(within(rows[2]).getByText('Dollar reserve')).toBeOnTheScreen()
    expect(view.getByLabelText(/Emergency reserve.*Behind.*€600\.00.*€1,000\.00.*€400\.00/)).toBeOnTheScreen()
    expect(view.getByLabelText(/Japan reserve.*Paused.*¥0.*Progress unavailable/)).toBeOnTheScreen()
    expect(view.getByLabelText(/Dollar reserve.*\$250\.00.*\$200\.00.*Over target/)).toBeOnTheScreen()
    expect(within(rows[2]).getByText('Progress 125% · Over target')).toBeOnTheScreen()
    expect(view.getByLabelText(/Dollar reserve.*Progress 125%.*Over target/)).toBeOnTheScreen()
    expect(StyleSheet.flatten(view.getByTestId('goal-progress-fill-5').props.style).width).toBe('100%')
    expect(within(rows[2]).getByText(/Monthly contribution.*\$0\.00/)).toBeOnTheScreen()
    expect(within(rows[1]).queryByText(/Monthly contribution|Target date/)).not.toBeOnTheScreen()
    expect(view.queryAllByRole('link')).toHaveLength(0)
    expect(rows[0].props.accessibilityRole).toBeUndefined()
  })

  it('does not aggregate goals or expose unrelated write, premium, or bank-transfer language', async () => {
    const { view } = await renderScreen({ status: 'loaded', data })
    expect(view.getByRole('button', { name: 'Create goal' })).toBeOnTheScreen()
    expect(view.queryByText(/total|add|edit|delete|premium|upgrade|bank transfer|transfer|transaction/i)).not.toBeOnTheScreen()
    expect(view.queryByRole('image')).not.toBeOnTheScreen()
  })

  it('explains on-track status without presenting it as a guarantee', async () => {
    const onTrack = mapGoalListItem({
      ...goalFixture,
      summary: { ...goalFixture.summary, status: 'on_track', monthlyShortfall: null },
    })
    const { view } = await renderScreen({ status: 'loaded', data: { goals: [onTrack] } })
    expect(view.getByText('On track means no calculable shortfall; it is not a guarantee')).toBeOnTheScreen()
  })

  it('formats progress with the active locale', async () => {
    const localized = mapGoalListItem({
      ...goalFixture,
      summary: { ...goalFixture.summary, availableAmount: 125, progressPercentage: 99 },
    })
    const { view } = await renderScreen({ status: 'loaded', data: { goals: [localized] } }, 'pt-PT')

    expect(view.getByText('Progresso 12,5%')).toBeOnTheScreen()
  })

  it('renders planning-reserve context, locale-aware preview data, and the deliberate create entry point when empty', async () => {
    const { view } = await renderScreen({ status: 'loaded', data: { goals: [] } })
    expect(view.getByText('Set aside money for a specific purpose')).toBeOnTheScreen()
    expect(view.getByText('Emergency fund')).toBeOnTheScreen()
    expect(view.getByText('€2,400.00')).toBeOnTheScreen()
    expect(view.getByText('€6,000.00')).toBeOnTheScreen()
    expect(view.getAllByText('40%')).toHaveLength(2)
    expect(view.getByText('Vacation')).toBeOnTheScreen()
    expect(view.getByText('€850.00')).toBeOnTheScreen()
    expect(view.getByText('€2,000.00')).toBeOnTheScreen()
    expect(view.getByText('43%')).toBeOnTheScreen()
    expect(view.getByText('Taxes')).toBeOnTheScreen()
    expect(view.getByRole('button', { name: 'Create goal' })).toBeOnTheScreen()
  })

  it('shows the epoch unknown banner and disables another create', async () => {
    const { view, createGoal } = await renderScreen({ status: 'loaded', data }, 'en', true)
    expect(view.getByRole('alert')).toHaveTextContent('Goal creation outcome unknown')
    expect(view.getByRole('button', { name: 'Create goal' })).toBeDisabled()
    await fireEvent.press(view.getByRole('button', { name: 'Create goal' }))
    expect(createGoal).not.toHaveBeenCalled()
  })

  it('reveals secondary activity and linked-account context without implying money movement', async () => {
    const { view } = await renderScreen({ status: 'loaded', data: { goals: [data.goals[0]] } })
    const disclosure = view.getByRole('button', { name: 'Show details for Emergency reserve' })
    expect(disclosure.props.accessibilityState).toMatchObject({ expanded: false })
    expect(StyleSheet.flatten(disclosure.props.style).minHeight).toBeGreaterThanOrEqual(44)
    expect(view.queryByLabelText('Assigned this month, €100.00')).not.toBeOnTheScreen()

    await fireEvent.press(disclosure)
    expect(view.getByRole('button', { name: 'Hide details for Emergency reserve' }).props.accessibilityState).toMatchObject({ expanded: true })
    expect(view.getByLabelText('Assigned this month, €100.00')).toBeOnTheScreen()
    expect(view.getByLabelText('Spent, €200.00')).toBeOnTheScreen()
    expect(view.getByText('Current account')).toBeOnTheScreen()
    expect(view.getByText("Linked account names provide context only and do not change the goal's available amount")).toBeOnTheScreen()
  })

  it('offers a separate accessible detail action without turning the row into a nested press target', async () => {
    const { view, viewGoal } = await renderScreen({ status: 'loaded', data: { goals: [data.goals[0]] } })
    const row = view.getByTestId('goal-row')
    expect(row.props.accessibilityRole).toBeUndefined()
    expect(within(row).getAllByRole('button')).toHaveLength(2)
    await fireEvent.press(view.getByRole('button', { name: 'View Emergency reserve' }))
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
      expect(view.getByText('Archived goals appear here')).toBeOnTheScreen()
    })

    it('dims each archived row and restores it inline without navigating away', async () => {
      const archivedData: GoalsData = { goals: [mapGoalListItem({ ...goalFixture, status: 'archived' })] }
      const { view, restoreGoal, viewGoal } = await renderScreen({ status: 'loaded', data: archivedData }, 'en', false, 'archived')
      const row = view.getByTestId('goal-row')
      expect(StyleSheet.flatten(row.props.style).opacity).toBeLessThan(1)
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

  it('wires the debt payoff strategy link', async () => {
    const { view, viewDebtStrategy } = await renderScreen({ status: 'loaded', data })
    fireEvent.press(view.getByRole('button', { name: 'Debt payoff strategy' }))
    expect(viewDebtStrategy).toHaveBeenCalled()
  })
})
