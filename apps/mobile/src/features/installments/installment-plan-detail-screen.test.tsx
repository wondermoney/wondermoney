import { fireEvent, render, within } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'
import { Alert } from 'react-native'

import { formatCurrency } from '@/lib/formatters/financial'
import { initMobileI18n } from '@/lib/i18n'

import { InstallmentPlanDetailScreen, type InstallmentPlanDetailScreenProps } from './installment-plan-detail-screen'
import { planDetailFixture } from './test-fixtures'

jest.mock('expo-router', () => ({ useRouter: () => ({ back: jest.fn(), canGoBack: () => true, replace: jest.fn() }) }))

async function renderScreen(props: Partial<InstallmentPlanDetailScreenProps> = {}) {
  const i18n = await initMobileI18n('en')
  const onDelete = jest.fn()
  const view = await render(
    <I18nextProvider i18n={i18n}>
      <InstallmentPlanDetailScreen
        backHref="/accounts/7"
        onDelete={onDelete}
        onLogout={jest.fn()}
        onRetry={jest.fn()}
        state={{ status: 'loaded', plan: planDetailFixture, stale: false }}
        {...props}
      />
    </I18nextProvider>,
  )
  return { view, onDelete }
}

const euro = (value: number) => formatCurrency(value, { locale: 'en', currency: 'EUR' })

describe('InstallmentPlanDetailScreen', () => {
  it('leads with what is still to come, then the total, the paid and the remaining amounts and counts', async () => {
    const { view } = await renderScreen()
    expect(view.getByRole('header', { name: 'Laptop' })).toBeOnTheScreen()
    expect(view.getByText('Purchased Aug 20, 2026 · 4 installments')).toBeOnTheScreen()
    expect(view.getByLabelText(`Remaining, ${euro(25)}`)).toBeOnTheScreen()
    expect(view.getByLabelText(`Paid, ${euro(50)}, 2 of 4 paid`)).toBeOnTheScreen()
    expect(view.getByLabelText(`Remaining, ${euro(25)}, 1 installment to come`)).toBeOnTheScreen()
    expect(view.getByText('1 past installment not matched')).toBeOnTheScreen()
    expect(view.getByText('In 4 installments')).toBeOnTheScreen()
  })

  it('lists every installment with its date, statement due date and status', async () => {
    const { view } = await renderScreen()
    const schedule = within(view.getByTestId('installment-plan-schedule'))
    expect(schedule.getByRole('header', { name: 'Schedule' })).toBeOnTheScreen()
    expect(within(view.getByTestId('installment-status-1')).getByText('Paid')).toBeOnTheScreen()
    expect(within(view.getByTestId('installment-status-2')).getByText('Paid')).toBeOnTheScreen()
    expect(within(view.getByTestId('installment-status-3')).getByText('Not matched')).toBeOnTheScreen()
    expect(within(view.getByTestId('installment-status-4')).getByText('Upcoming')).toBeOnTheScreen()
    // A paid row says when the bank posted it; a projection when it is expected, and its statement.
    expect(view.getByLabelText(`Installment 2 of 4, ${euro(25)}, Scheduled Oct 5, 2026, Statement due Oct 20, 2026, Posted Oct 6, 2026, Paid`)).toBeOnTheScreen()
    expect(view.getByLabelText(`Installment 4 of 4, ${euro(25)}, Scheduled Dec 5, 2026, Statement due Dec 20, 2026, Upcoming`)).toBeOnTheScreen()
    // No card cycle: no statement line.
    expect(view.getByLabelText(`Installment 3 of 4, ${euro(25)}, Scheduled Nov 5, 2026, Not matched`)).toBeOnTheScreen()
    expect(view.getByText('Upcoming installments are projections: they are not transactions and are not counted in balances.')).toBeOnTheScreen()
  })

  it('deletes only after the confirmation', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined)
    const { view, onDelete } = await renderScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Delete plan' }))
    expect(onDelete).not.toHaveBeenCalled()
    expect(alert).toHaveBeenCalledWith('Delete this installment plan?', expect.stringContaining('Posted transactions stay'), expect.any(Array))
    const buttons = alert.mock.calls[0]?.[2] ?? []
    expect(buttons.map((button) => button.text)).toEqual(['Cancel', 'Delete'])
    expect(buttons[1]?.style).toBe('destructive')
    buttons[1]?.onPress?.()
    expect(onDelete).toHaveBeenCalledTimes(1)
    alert.mockRestore()
  })

  it('says why a delete failed', async () => {
    const { view } = await renderScreen({ deleteFailure: 'network' })
    expect(view.getByTestId('installment-plan-delete-failure')).toHaveTextContent(/Could not reach the server/)
  })

  it.each([
    ['not-found', 'Plan not found'],
    ['invalid-id', 'Plan not found'],
    ['invalid-response', 'Plan unavailable'],
    ['error', 'Could not load the plan'],
  ] as const)('shows a %s page with its own title', async (status, title) => {
    const { view } = await renderScreen({ state: { status } })
    expect(view.getByRole('header', { name: title })).toBeOnTheScreen()
    expect(view.queryByRole('button', { name: 'Delete plan' })).not.toBeOnTheScreen()
  })
})
