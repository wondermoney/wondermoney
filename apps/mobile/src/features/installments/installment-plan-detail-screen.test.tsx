import { fireEvent, render, within } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'
import { Alert } from 'react-native'

import { formatCurrency } from '@/lib/formatters/financial'
import { initMobileI18n } from '@/lib/i18n'

import { InstallmentPlanDetailScreen, type InstallmentPlanDetailScreenProps } from './installment-plan-detail-screen'
import { planDetailFixture } from './test-fixtures'
import type { InstallmentLinking } from './use-installment-linking'

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

  describe('manual links', () => {
    const linkingFor = (overrides: Partial<InstallmentLinking> = {}): InstallmentLinking => ({
      target: null,
      candidates: { status: 'loading' },
      showAllAmounts: false,
      pending: false,
      failure: null,
      open: jest.fn(),
      close: jest.fn(),
      toggleShowAllAmounts: jest.fn(),
      link: jest.fn(async () => undefined),
      unlink: jest.fn(async () => undefined),
      ...overrides,
    })

    it('offers Link transaction on an unmatched installment and Unlink, after a confirmation, on a paid one', async () => {
      const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined)
      const linking = linkingFor()
      const { view } = await renderScreen({ linking })

      await fireEvent.press(view.getByRole('button', { name: 'Actions for installment 3 of 4' }))
      await fireEvent.press(within(view.getByTestId('installment-row-menu')).getByRole('menuitem', { name: 'Link transaction' }))
      expect(linking.open).toHaveBeenCalledWith(3)

      await fireEvent.press(view.getByRole('button', { name: 'Actions for installment 1 of 4' }))
      await fireEvent.press(within(view.getByTestId('installment-row-menu')).getByRole('menuitem', { name: 'Unlink' }))
      expect(linking.unlink).not.toHaveBeenCalled()
      expect(alert).toHaveBeenCalledWith('Unlink installment 1 of 4?', expect.stringContaining('no longer counts as paid'), expect.any(Array))
      const buttons = alert.mock.calls[0]?.[2] ?? []
      expect(buttons.map((button) => button.text)).toEqual(['Cancel', 'Unlink'])
      buttons[1]?.onPress?.()
      expect(linking.unlink).toHaveBeenCalledWith(1)
      alert.mockRestore()
    })

    it('offers no row actions without linking', async () => {
      const { view } = await renderScreen()
      expect(view.queryByRole('button', { name: 'Actions for installment 3 of 4' })).not.toBeOnTheScreen()
    })

    it('lists the candidates closest first and links the chosen one', async () => {
      const linking = linkingFor({
        target: 3,
        candidates: { status: 'loaded', rows: [
          { transactionKey: 904, title: 'LAPTOP 3/4', day: '2026-11-06', amount: 25, amountDifference: 0, dayDistance: 1 },
          { transactionKey: 905, title: 'Laptop shop', day: '2026-11-09', amount: 26, amountDifference: 1, dayDistance: 4 },
        ] },
      })
      const { view } = await renderScreen({ linking })
      const sheet = within(view.getByTestId('installment-link-sheet'))
      expect(sheet.getByRole('header', { name: 'Link installment 3 of 4' })).toBeOnTheScreen()
      expect(sheet.getByText(`Posted charges on this card within a month of Nov 5, 2026, for about ${euro(25)}.`)).toBeOnTheScreen()
      expect(sheet.getByLabelText(`Laptop shop, ${euro(26)}, Nov 9, 2026, ${euro(1)} more than the installment`)).toBeOnTheScreen()

      const link = sheet.getByRole('button', { name: 'Link' })
      expect(link).toBeDisabled()
      await fireEvent.press(sheet.getByTestId('installment-candidate-904'))
      await fireEvent.press(sheet.getByRole('button', { name: 'Link' }))
      expect(linking.link).toHaveBeenCalledWith(904)

      await fireEvent.press(sheet.getByRole('button', { name: 'Show other amounts' }))
      expect(linking.toggleShowAllAmounts).toHaveBeenCalled()
    })

    it('says when nothing fits, and why a link was refused', async () => {
      const linking = linkingFor({ target: 3, candidates: { status: 'loaded', rows: [] }, failure: 'installments.link.failures.alreadyLinked' })
      const { view } = await renderScreen({ linking })
      const sheet = within(view.getByTestId('installment-link-sheet'))
      expect(sheet.getByText('No posted charge on this card fits this installment.')).toBeOnTheScreen()
      expect(sheet.getByTestId('installment-link-failure')).toHaveTextContent(/already pays an installment/)
    })

    it('shows a failed unlink on the page', async () => {
      const { view } = await renderScreen({ linking: linkingFor({ failure: 'installments.link.failures.unlinkFailed' }) })
      expect(view.getByTestId('installment-link-failure')).toHaveTextContent('Could not unlink the installment. Try again.')
    })
  })
})
