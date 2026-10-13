import { fireEvent, render } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { initMobileI18n } from '@/lib/i18n'

import { LoanRepaymentWorkflow } from './loan-repayment-workflow'
import { mapLoan, mapRepayments } from './loans-view-model'
import { loanFixture, repaymentCandidateFixture, repaymentFixture } from './test-fixtures'

const loan = mapLoan(loanFixture)
const repayments = mapRepayments({ repayments: [repaymentFixture] })

const renderWorkflow = async (overrides: Partial<React.ComponentProps<typeof LoanRepaymentWorkflow>> = {}, locale = 'en') => {
  const i18n = await initMobileI18n(locale)
  const props: React.ComponentProps<typeof LoanRepaymentWorkflow> = {
    loan,
    candidates: { status: 'loaded', candidates: [repaymentCandidateFixture] },
    repayments,
    pending: false,
    refreshRequired: false,
    onWrite: jest.fn().mockResolvedValue('success'),
    onRefreshCandidates: jest.fn(),
    onResolveUnknown: jest.fn().mockResolvedValue(true),
    ...overrides,
  }
  const view = await render(<I18nextProvider i18n={i18n}><LoanRepaymentWorkflow {...props} /></I18nextProvider>)
  return { view, props }
}

describe('LoanRepaymentWorkflow', () => {
  it('requires an explicit frozen review before linking and explains classification-only behavior', async () => {
    const write = jest.fn().mockResolvedValue('success')
    const { view } = await renderWorkflow({ onWrite: write })
    expect(view.getByText(/does not move money or instruct a bank/i)).toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Review candidate' }))
    expect(view.getByRole('header', { name: 'Allocate candidate repayment' })).toBeOnTheScreen()
    expect(write).not.toHaveBeenCalled()
    await fireEvent.press(view.getByRole('button', { name: 'Review allocation' }))
    expect(view.getByRole('header', { name: 'Review repayment link' })).toBeOnTheScreen()
    expect(write).not.toHaveBeenCalled()
    await fireEvent.press(view.getByRole('button', { name: 'Confirm change' }))
    expect(write).toHaveBeenCalledWith({ type: 'link', loanId: 7, transactionKey: 82, allocation: { principalAmount: 645, interestAmount: 300, feeAmount: 5, totalPaymentAmount: 950 } })
    view.unmount()
  })

  it('requires unlink confirmation and cancellation performs no write', async () => {
    const write = jest.fn().mockResolvedValue('success')
    const { view } = await renderWorkflow({ onWrite: write })
    await fireEvent.press(view.getByRole('button', { name: 'Unlink' }))
    expect(view.getByRole('header', { name: 'Unlink this repayment?' })).toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Keep linked' }))
    expect(write).not.toHaveBeenCalled()
    await fireEvent.press(view.getByRole('button', { name: 'Unlink' }))
    await fireEvent.press(view.getByRole('button', { name: 'Confirm unlink' }))
    expect(write).toHaveBeenCalledWith({ type: 'unlink', loanId: 7, repaymentLinkId: 21 })
    view.unmount()
  })

  it('blocks every repayment action behind the unknown gate until both reads refresh', async () => {
    const resolve = jest.fn().mockResolvedValue(true)
    const { view } = await renderWorkflow({ refreshRequired: true, onResolveUnknown: resolve })
    expect(view.getByRole('alert')).toHaveTextContent(/both repayment history and candidates/i)
    expect(view.queryByRole('button', { name: 'Review candidate' })).toBeNull()
    expect(view.queryByRole('button', { name: 'Edit allocation' })).toBeNull()
    await fireEvent.press(view.getByRole('button', { name: 'Refresh history and candidates' }))
    expect(resolve).toHaveBeenCalledTimes(1)
    view.unmount()
  })

  it('discards the retained write after authoritative inspection instead of offering a replay', async () => {
    const i18n = await initMobileI18n('en')
    const common = { loan, candidates: { status: 'loaded' as const, candidates: [repaymentCandidateFixture] }, repayments, pending: false, onWrite: jest.fn().mockResolvedValue('unknown' as const), onRefreshCandidates: jest.fn(), onResolveUnknown: jest.fn().mockResolvedValue(true) }
    const view = await render(<I18nextProvider i18n={i18n}><LoanRepaymentWorkflow {...common} refreshRequired={false} /></I18nextProvider>)
    await fireEvent.press(view.getByRole('button', { name: 'Review candidate' }))
    await fireEvent.press(view.getByRole('button', { name: 'Review allocation' }))
    expect(view.getByRole('button', { name: 'Confirm change' })).toBeOnTheScreen()
    await view.rerender(<I18nextProvider i18n={i18n}><LoanRepaymentWorkflow {...common} refreshRequired /></I18nextProvider>)
    await fireEvent.press(view.getByRole('button', { name: 'Refresh history and candidates' }))
    await view.rerender(<I18nextProvider i18n={i18n}><LoanRepaymentWorkflow {...common} refreshRequired={false} /></I18nextProvider>)
    expect(view.queryByRole('button', { name: 'Confirm change' })).toBeNull()
    expect(view.getByRole('button', { name: 'Review candidate' })).toBeOnTheScreen()
    view.unmount()
  })

  it('uses localized accessible labels and marks only active confirmation busy', async () => {
    const { view } = await renderWorkflow({}, 'es')
    expect(view.getByRole('header', { name: 'Correspondencia de pagos' })).toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Revisar candidato' }))
    await fireEvent.press(view.getByRole('button', { name: 'Revisar distribución' }))
    const i18n = await initMobileI18n('es')
    await view.rerender(<I18nextProvider i18n={i18n}><LoanRepaymentWorkflow loan={loan} candidates={{ status: 'loaded', candidates: [repaymentCandidateFixture] }} repayments={repayments} pending refreshRequired={false} onWrite={jest.fn().mockResolvedValue('success')} onRefreshCandidates={jest.fn()} onResolveUnknown={jest.fn().mockResolvedValue(true)} /></I18nextProvider>)
    expect(view.getByText('Guardando…').parent?.props.accessibilityState).toMatchObject({ disabled: true, busy: true })
    expect(view.getByText('Cancelar').parent?.props.accessibilityState).toMatchObject({ disabled: true, busy: false })
    view.unmount()
  })
})
