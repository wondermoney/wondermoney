import { act, fireEvent, render, waitFor } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'
import { Alert, StyleSheet } from 'react-native'

import { initMobileI18n } from '@/lib/i18n'

import { GoalDetailScreen, type GoalDetailData, type GoalDetailViewState } from './goal-detail-screen'
import { mapGoalActivities, mapGoalDetail } from './goal-detail-view-model'
import { goalFixture } from './test-fixtures'

const { summary, ...goal } = goalFixture
const data: GoalDetailData = {
  goal: mapGoalDetail({
    goal,
    summary: { ...summary, availableAmount: 1250, remainingToTarget: 0, progressPercentage: 100, status: 'funded' },
  }),
  activities: mapGoalActivities([{
    goalActivityKey: 1,
    type: 'assigned',
    amount: 25,
    occurredAt: '2026-07-19T10:00:00.000Z',
    note: 'Monthly plan',
    currencyCode: 'EUR',
  }], 'EUR'),
  totalActivities: 26,
}

async function renderScreen(state: GoalDetailViewState, locale = 'en', mutationPending = false, goalWriteUnknown = false) {
  const i18n = await initMobileI18n(locale)
  const handlers = { back: jest.fn(), refresh: jest.fn(), loadMore: jest.fn(), logout: jest.fn(), save: jest.fn(), link: jest.fn(), unlink: jest.fn(), assign: jest.fn(), moveOut: jest.fn(), archive: jest.fn().mockResolvedValue(undefined), pendingCheck: jest.fn(() => false) }
  const view = await render(<I18nextProvider i18n={i18n}><GoalDetailScreen state={state} onBack={handlers.back} onRefresh={handlers.refresh} onLoadMore={handlers.loadMore} onLogout={handlers.logout} accountContext={{ status: 'loaded', accounts: [{ accountId: 42, name: 'Current account' }, { accountId: 55, name: 'Savings account' }] }} mutationPending={mutationPending} goalWriteUnknown={goalWriteUnknown} isGoalWriteBlocked={handlers.pendingCheck} onSaveMetadata={handlers.save} onLinkAccount={handlers.link} onUnlinkAccount={handlers.unlink} onAssign={handlers.assign} onMoveOut={handlers.moveOut} onArchive={handlers.archive} /></I18nextProvider>)
  return { view, handlers }
}

describe('GoalDetailScreen', () => {
  it('shows the complete read-only summary and actual overfunded percentage', async () => {
    const { view } = await renderScreen({ status: 'loaded', data, activityStatus: 'loaded', hasMore: true })
    expect(view.getByRole('header', { name: 'Emergency reserve' })).toBeOnTheScreen()
    expect(view.getByText('Progress 125% · Over target')).toBeOnTheScreen()
    expect(StyleSheet.flatten(view.getByTestId('goal-detail-progress-fill').props.style).width).toBe('100%')
    expect(view.getByLabelText('Remaining, €0.00')).toBeOnTheScreen()
    expect(view.getByLabelText('Assigned this month, €100.00')).toBeOnTheScreen()
    expect(view.getByLabelText('Required contribution, €150.00')).toBeOnTheScreen()
    expect(view.getByLabelText('Shortfall, €25.00')).toBeOnTheScreen()
    expect(view.getByLabelText('Spent, €200.00')).toBeOnTheScreen()
    expect(view.getAllByText('Current account').length).toBeGreaterThan(0)
    expect(view.getByText('Account names are context only')).toBeOnTheScreen()
    expect(view.getByText('Showing 1 of 26')).toBeOnTheScreen()
    expect(view.getByRole('button', { name: 'Link account context' })).toBeOnTheScreen()
    expect(view.queryByText(/balance/i)).not.toBeOnTheScreen()
  })

  it('localizes activity type, date, amount, and loads another offset page explicitly', async () => {
    const { view, handlers } = await renderScreen({ status: 'loaded', data, activityStatus: 'loaded', hasMore: true }, 'pt-PT')
    expect(view.getByText('Atribuído')).toBeOnTheScreen()
    expect(view.getAllByText('25,00 €')).toHaveLength(2)
    expect(view.getByText('Monthly plan')).toBeOnTheScreen()
    const loadMore = view.getByRole('button', { name: 'Carregar mais' })
    expect(StyleSheet.flatten(loadMore.props.style).minHeight).toBeGreaterThanOrEqual(44)
    await fireEvent.press(loadMore)
    expect(handlers.loadMore).toHaveBeenCalledTimes(1)
  })

  it('renders explicit empty, activity error, load-more error, and stale states', async () => {
    const emptyData = { ...data, activities: [], totalActivities: 0 }
    const empty = await renderScreen({ status: 'loaded', data: emptyData, activityStatus: 'loaded', hasMore: false })
    expect(empty.view.getByText('No activity is available for this goal')).toBeOnTheScreen()

    const activityError = await renderScreen({ status: 'loaded', data: emptyData, activityStatus: 'error', hasMore: false })
    expect(activityError.view.getByText('Could not load goal activity. Check your connection and try again')).toBeOnTheScreen()

    const loadError = await renderScreen({ status: 'loaded', data, activityStatus: 'loaded', hasMore: true, loadMoreError: true })
    expect(loadError.view.getByText('Could not load more activity. Try again')).toBeOnTheScreen()

    const stale = await renderScreen({ status: 'refresh-error', data, activityStatus: 'loaded', hasMore: false })
    expect(stale.view.getByText('Could not refresh. Showing previously loaded goal details and activity')).toBeOnTheScreen()
    expect(stale.view.getByText('Emergency reserve')).toBeOnTheScreen()
  })

  it.each([
    ['loading', 'Loading goal details'],
    ['error', 'Could not load this goal'],
    ['not-found', 'Goal not found'],
    ['invalid-id', 'Goal not available'],
    ['invalid-response', 'Could not verify goal data'],
  ] as const)('renders the explicit %s state', async (status, expected) => {
    const { view } = await renderScreen({ status })
    expect(status === 'loading' ? view.getByRole('progressbar', { name: expected }) : view.getByText(expected)).toBeOnTheScreen()
  })

  it('renders nothing while the MFA boundary takes over', async () => {
    const { view } = await renderScreen({ status: 'access-transition' })
    expect(view.toJSON()).toBeNull()
  })

  it('submits only dirty metadata, validates four decimals, and retains ambiguous input', async () => {
    const { view, handlers } = await renderScreen({ status: 'loaded', data, activityStatus: 'loaded', hasMore: false })
    const save = view.getByRole('button', { name: 'Save changes' })
    expect(save).toBeDisabled()
    await fireEvent.changeText(view.getByLabelText('Name'), '  Rainy day  ')
    await fireEvent.changeText(view.getByLabelText('Monthly contribution target'), '')
    expect(view.getByRole('button', { name: 'Save changes' })).toBeEnabled()
    await fireEvent.press(view.getByRole('button', { name: 'Save changes' }))
    expect(handlers.save).toHaveBeenCalledWith({ name: 'Rainy day', monthlyContributionTarget: null })

    handlers.save.mockRejectedValueOnce(new (jest.requireActual('@/lib/api/errors').ApiError)('network'))
    await fireEvent.changeText(view.getByLabelText('Target amount'), '12.34567')
    await fireEvent.press(view.getByRole('button', { name: 'Save changes' }))
    expect(view.getByText('Check the highlighted details. Amounts must be positive and use no more than four decimal places')).toBeOnTheScreen()
    expect(view.getByLabelText('Target amount').props.value).toBe('12.34567')
    await fireEvent.changeText(view.getByLabelText('Target amount'), '12.3456')
    await fireEvent.press(view.getByRole('button', { name: 'Save changes' }))
    expect(view.getByText(/connection ended before we could confirm/i)).toBeOnTheScreen()
    expect(view.getByLabelText('Target amount').props.value).toBe('12.3456')
  })

  it('treats trim and numeric formatting equivalents as no-ops while distinguishing invalid input', async () => {
    const { view, handlers } = await renderScreen({ status: 'loaded', data, activityStatus: 'loaded', hasMore: false })
    await fireEvent.changeText(view.getByLabelText('Name'), '  Emergency reserve  ')
    await fireEvent.changeText(view.getByLabelText('Target amount'), '1000.0')
    await fireEvent.changeText(view.getByLabelText('Monthly contribution target'), '125.0')
    const save = view.getByRole('button', { name: 'Save changes' })
    expect(save).toBeDisabled()
    await fireEvent.press(save)
    expect(handlers.save).not.toHaveBeenCalled()
    expect(view.queryByText('Check the highlighted details. Amounts must be positive and use no more than four decimal places')).not.toBeOnTheScreen()

    await fireEvent.changeText(view.getByLabelText('Target amount'), '1000.00001')
    expect(view.getByRole('button', { name: 'Save changes' })).toBeEnabled()
    await fireEvent.press(view.getByRole('button', { name: 'Save changes' }))
    expect(view.getByText('Check the highlighted details. Amounts must be positive and use no more than four decimal places')).toBeOnTheScreen()
    expect(handlers.save).not.toHaveBeenCalled()
  })

  it('confirms and freezes a localized assign payload, clears only on success, and announces it', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(jest.fn())
    const { view, handlers } = await renderScreen({ status: 'loaded', data, activityStatus: 'loaded', hasMore: false }, 'pt-PT')
    handlers.assign.mockResolvedValue(undefined)
    await fireEvent.changeText(view.getByLabelText('Montante'), '10,5000')
    await fireEvent.press(view.getByRole('button', { name: 'Atribuir ao objetivo' }))
    expect(alert).toHaveBeenCalledWith(
      'Atribuir a Emergency reserve?',
      expect.stringMatching(/10,50 €.*Emergency reserve.*alocação de planeamento.*transferência bancária/i),
      expect.any(Array),
      expect.objectContaining({ cancelable: true }),
    )
    await fireEvent.changeText(view.getByLabelText('Montante'), '99')
    expect(view.getByLabelText('Montante').props.value).toBe('10,5000')
    const buttons = alert.mock.calls[0][2]!
    await act(async () => { buttons[1]?.onPress?.(); await Promise.resolve() })
    expect(handlers.assign).toHaveBeenCalledWith(10.5)
    await waitFor(() => expect(view.getByLabelText('Montante').props.value).toBe(''))
    expect(view.getByText('Foram atribuídos 10,50 € a Emergency reserve')).toBeOnTheScreen()
    alert.mockRestore()
  })

  it('prechecks available reserve and never opens a move-out confirmation for excess', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(jest.fn())
    const { view, handlers } = await renderScreen({ status: 'loaded', data, activityStatus: 'loaded', hasMore: false })
    await fireEvent.changeText(view.getByLabelText('Amount'), '1250.0001')
    await fireEvent.press(view.getByRole('button', { name: 'Move out of goal' }))
    expect(view.getByText(/cannot exceed the available reserve/i)).toBeOnTheScreen()
    expect(alert).not.toHaveBeenCalled()
    expect(handlers.moveOut).not.toHaveBeenCalled()
    expect(view.getByLabelText('Amount').props.value).toBe('1250.0001')
    alert.mockRestore()
  })

  it('confirms move-out as a frozen planning allocation without bank transfer wording', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(jest.fn())
    const { view, handlers } = await renderScreen({ status: 'loaded', data, activityStatus: 'loaded', hasMore: false })
    handlers.moveOut.mockResolvedValue(undefined)
    await fireEvent.changeText(view.getByLabelText('Amount'), '20.2500')
    await fireEvent.press(view.getByRole('button', { name: 'Move out of goal' }))
    expect(alert).toHaveBeenCalledWith(
      'Move out of Emergency reserve?',
      expect.stringMatching(/Move €20\.25 out of Emergency reserve.*planning allocation only; no bank transfer/i),
      expect.any(Array),
      expect.objectContaining({ cancelable: true }),
    )
    const buttons = alert.mock.calls[0][2]!
    await act(async () => { buttons[1]?.onPress?.(); await Promise.resolve() })
    expect(handlers.moveOut).toHaveBeenCalledWith(20.25)
    alert.mockRestore()
  })

  it('rechecks the shared lock in an open reserve confirmation and retains definitive failure input', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(jest.fn())
    const { view, handlers } = await renderScreen({ status: 'loaded', data, activityStatus: 'loaded', hasMore: false })
    await fireEvent.changeText(view.getByLabelText('Amount'), '25')
    await fireEvent.press(view.getByRole('button', { name: 'Assign to goal' }))
    const buttons = alert.mock.calls[0][2]!
    handlers.pendingCheck.mockReturnValue(true)
    await act(() => buttons[1]?.onPress?.())
    expect(handlers.assign).not.toHaveBeenCalled()
    handlers.pendingCheck.mockReturnValue(false)
    handlers.assign.mockRejectedValueOnce(new (jest.requireActual('@/lib/api/errors').ApiError)('demo-forbidden', 403))
    await fireEvent.press(view.getByRole('button', { name: 'Assign to goal' }))
    const latestButtons = alert.mock.calls.at(-1)![2]!
    await act(async () => { latestButtons[1]?.onPress?.(); await Promise.resolve() })
    await waitFor(() => expect(view.getByText(/Demo mode is read-only/)).toBeOnTheScreen())
    expect(view.getByLabelText('Amount').props.value).toBe('25')
    alert.mockRestore()
  })

  it('retains reserve input after an ambiguous invalid response without offering a direct retry', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(jest.fn())
    const { view, handlers } = await renderScreen({ status: 'loaded', data, activityStatus: 'loaded', hasMore: false })
    handlers.assign.mockRejectedValueOnce(new (jest.requireActual('@/lib/api/errors').ApiError)('invalid-response'))
    await fireEvent.changeText(view.getByLabelText('Amount'), '30.125')
    await fireEvent.press(view.getByRole('button', { name: 'Assign to goal' }))
    const buttons = alert.mock.calls[0][2]!
    await act(async () => { buttons[1]?.onPress?.(); await Promise.resolve() })
    await waitFor(() => expect(view.getByText(/reserve response could not be verified/i)).toBeOnTheScreen())
    expect(view.getByLabelText('Amount').props.value).toBe('30.125')
    expect(view.queryByRole('button', { name: /retry/i })).not.toBeOnTheScreen()
    alert.mockRestore()
  })

  it('shows the ambiguous gate and disables every goal mutation control until refresh recovery', async () => {
    const { view } = await renderScreen({ status: 'loaded', data, activityStatus: 'loaded', hasMore: false }, 'en', false, true)
    expect(view.getByText(/Goal writes are locked until goal details and activity refresh successfully/)).toBeOnTheScreen()
    expect(view.getByLabelText('Amount').props.editable).toBe(false)
    expect(view.getByRole('button', { name: 'Assign to goal' })).toBeDisabled()
    expect(view.getByRole('button', { name: 'Move out of goal' })).toBeDisabled()
    expect(view.getByLabelText('Name').props.editable).toBe(false)
    expect(view.getByRole('button', { name: 'Unlink Current account' })).toBeDisabled()
  })

  it('filters linked accounts, guards duplicate context, and confirms unlink with no-movement copy', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(jest.fn())
    const { view, handlers } = await renderScreen({ status: 'loaded', data, activityStatus: 'loaded', hasMore: false })
    expect(view.queryByRole('radio', { name: 'Current account' })).not.toBeOnTheScreen()
    const savings = view.getByLabelText('Savings account')
    await fireEvent.press(savings)
    await fireEvent.press(view.getByRole('button', { name: 'Link account context' }))
    expect(handlers.link).toHaveBeenCalledWith(55)
    fireEvent.press(view.getByRole('button', { name: 'Unlink Current account' }))
    expect(alert).toHaveBeenCalledWith(
      'Unlink Current account?',
      expect.stringMatching(/context only.*does not move money.*or change the goal balance/i),
      expect.any(Array),
    )
    handlers.unlink.mockResolvedValue(undefined)
    const buttons = alert.mock.calls[0][2]!
    handlers.pendingCheck.mockReturnValue(true)
    buttons[1]?.onPress?.()
    expect(handlers.unlink).not.toHaveBeenCalled()
    handlers.pendingCheck.mockReturnValue(false)
    buttons[1]?.onPress?.()
    expect(handlers.unlink).toHaveBeenCalledWith(42)
    alert.mockRestore()
  })

  it('keeps every goal write control locked from authoritative pending state', async () => {
    const { view } = await renderScreen({ status: 'loaded', data, activityStatus: 'loaded', hasMore: false }, 'en', true)
    expect(view.getByLabelText('Name').props.editable).toBe(false)
    expect(view.getByRole('button', { name: 'Saving' })).toBeDisabled()
    expect(view.getByRole('button', { name: 'Unlink Current account' })).toBeDisabled()
    expect(view.getByRole('button', { name: 'Linking' })).toBeDisabled()
    expect(view.getByRole('button', { name: 'Updating reserve' })).toBeDisabled()
    expect(view.getByRole('button', { name: 'Move out of goal' })).toBeDisabled()
  })

  it.each(['archived', 'completed'] as const)('exposes no mutation controls, including archive, for %s goals', async (status) => {
    const lockedGoal = mapGoalDetail({ goal: { ...goal, status }, summary })
    const { view } = await renderScreen({ status: 'loaded', data: { ...data, goal: lockedGoal }, activityStatus: 'loaded', hasMore: false })
    expect(view.queryByText('Goal details')).not.toBeOnTheScreen()
    expect(view.queryByText('Internal reserve')).not.toBeOnTheScreen()
    expect(view.queryByRole('button', { name: /save|link|unlink|assign|move|archive/i })).not.toBeOnTheScreen()
  })

  it('keeps paused goals editable', async () => {
    const pausedGoal = mapGoalDetail({ goal: { ...goal, status: 'paused' }, summary: { ...summary, status: 'paused' } })
    const { view } = await renderScreen({ status: 'loaded', data: { ...data, goal: pausedGoal }, activityStatus: 'loaded', hasMore: false })
    expect(view.getByText('Goal details')).toBeOnTheScreen()
    expect(view.getByRole('button', { name: 'Save changes' })).toBeDisabled()
  })

  describe('archive', () => {
    it('redirects to move-out instead of confirming archive when a balance remains', async () => {
      const alert = jest.spyOn(Alert, 'alert').mockImplementation(jest.fn())
      const { view, handlers } = await renderScreen({ status: 'loaded', data, activityStatus: 'loaded', hasMore: false })
      await fireEvent.press(view.getByRole('button', { name: 'Archive goal' }))
      expect(alert).toHaveBeenCalledWith('Move money out first', expect.stringContaining('Move it out below'))
      expect(handlers.archive).not.toHaveBeenCalled()
      alert.mockRestore()
    })

    it('archives only after explicit confirmation once the balance is zero', async () => {
      const alert = jest.spyOn(Alert, 'alert').mockImplementation(jest.fn())
      const zeroBalanceGoal = mapGoalDetail({ goal, summary: { ...summary, availableAmount: 0 } })
      const { view, handlers } = await renderScreen({ status: 'loaded', data: { ...data, goal: zeroBalanceGoal }, activityStatus: 'loaded', hasMore: false })
      await fireEvent.press(view.getByRole('button', { name: 'Archive goal' }))
      const buttons = alert.mock.calls[0][2]!
      expect(handlers.archive).not.toHaveBeenCalled()
      await act(async () => { buttons[1]?.onPress?.(); await Promise.resolve() })
      expect(handlers.archive).toHaveBeenCalledTimes(1)
      alert.mockRestore()
    })

    it('does not archive when the confirmation is cancelled', async () => {
      const alert = jest.spyOn(Alert, 'alert').mockImplementation(jest.fn())
      const zeroBalanceGoal = mapGoalDetail({ goal, summary: { ...summary, availableAmount: 0 } })
      const { view, handlers } = await renderScreen({ status: 'loaded', data: { ...data, goal: zeroBalanceGoal }, activityStatus: 'loaded', hasMore: false })
      await fireEvent.press(view.getByRole('button', { name: 'Archive goal' }))
      const buttons = alert.mock.calls[0][2]!
      await act(() => buttons[0]?.onPress?.())
      expect(handlers.archive).not.toHaveBeenCalled()
      alert.mockRestore()
    })

    it('surfaces a classified failure without navigating away', async () => {
      const alert = jest.spyOn(Alert, 'alert').mockImplementation(jest.fn())
      const zeroBalanceGoal = mapGoalDetail({ goal, summary: { ...summary, availableAmount: 0 } })
      const { view, handlers } = await renderScreen({ status: 'loaded', data: { ...data, goal: zeroBalanceGoal }, activityStatus: 'loaded', hasMore: false })
      handlers.archive.mockRejectedValueOnce(new (jest.requireActual('@/lib/api/errors').ApiError)('demo-forbidden', 403))
      await fireEvent.press(view.getByRole('button', { name: 'Archive goal' }))
      const buttons = alert.mock.calls[0][2]!
      await act(async () => { buttons[1]?.onPress?.(); await Promise.resolve() })
      await waitFor(() => expect(view.getByText(/Demo mode is read-only/)).toBeOnTheScreen())
      alert.mockRestore()
    })

    it('locks the archive action from authoritative pending state', async () => {
      const zeroBalanceGoal = mapGoalDetail({ goal, summary: { ...summary, availableAmount: 0 } })
      const { view } = await renderScreen({ status: 'loaded', data: { ...data, goal: zeroBalanceGoal }, activityStatus: 'loaded', hasMore: false }, 'en', true)
      expect(view.getByRole('button', { name: 'Archiving…' })).toBeDisabled()
    })
  })
})
