import { act, fireEvent, render, waitFor } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { initMobileI18n } from '@/lib/i18n'

import { RecurringScreen } from './recurring-screen'
import { mapRecurringItems, mapRecurringSummary } from './recurring-view-model'
import { recurringItemFixture, recurringSummaryFixture } from './test-fixtures'

describe('RecurringScreen', () => {
  it('renders server totals, grounded row context, and candidate mutation controls', async () => {
    const i18n = await initMobileI18n('en')
    const rows = mapRecurringItems({ items: [recurringItemFixture, { ...recurringItemFixture, recurringSeriesKey: 8, displayName: 'Power bill', type: 'bill', amountType: 'variable', expectedAmount: null, expectedAmountMin: 40, expectedAmountMax: 60, confidenceScore: 80, status: 'candidate' }] }, new Map([[2, 'Daily account']]))
    const view = await render(<I18nextProvider i18n={i18n}><RecurringScreen state={{ status: 'loaded', rows, summary: mapRecurringSummary(recurringSummaryFixture), refreshing: false }} onBack={jest.fn()} onRefresh={jest.fn()} /></I18nextProvider>)
    expect(view.getByText('Server monthly summary')).toBeOnTheScreen()
    expect(view.getByText('Music service')).toBeOnTheScreen()
    expect(view.getAllByText('Entertainment · Daily account')).toHaveLength(2)
    expect(view.getByText('Needs review · confidence below 90%')).toBeOnTheScreen()
    expect(view.getByText(/€40\.00–€60\.00/)).toBeOnTheScreen()
    expect(view.getByRole('button', { name: 'Confirm' })).toBeOnTheScreen()
    expect(view.getByRole('button', { name: 'Dismiss' })).toBeOnTheScreen()
    expect(view.getAllByRole('button', { name: 'Edit details' })).toHaveLength(2)
    expect(view.getByRole('button', { name: 'Back to Accounts' })).toBeOnTheScreen()
  })
  it.each(['loading', 'invalid-response', 'error', 'no-account', 'access-transition'] as const)('handles %s', async (status) => {
    const i18n = await initMobileI18n('en')
    const props = { onBack: jest.fn(), onRefresh: jest.fn() }
    const view = await render(<I18nextProvider i18n={i18n}><RecurringScreen state={{ status }} {...props} /></I18nextProvider>)
    if (status === 'access-transition') expect(view.toJSON()).toBeNull()
    else expect(view.toJSON()).not.toBeNull()
  })
  it('distinguishes no-items and retained stale results', async () => {
    const i18n = await initMobileI18n('en')
    const props = { onBack: jest.fn(), onRefresh: jest.fn() }
    const empty = await render(<I18nextProvider i18n={i18n}><RecurringScreen state={{ status: 'loaded', rows: [], summary: mapRecurringSummary(recurringSummaryFixture), refreshing: false }} {...props} /></I18nextProvider>)
    expect(empty.getByText('No recurring activity identified')).toBeOnTheScreen()
    await empty.unmount()
    const stale = await render(<I18nextProvider i18n={i18n}><RecurringScreen state={{ status: 'refresh-error', rows: [], summary: mapRecurringSummary(recurringSummaryFixture), refreshing: false }} {...props} /></I18nextProvider>)
    expect(stale.getByRole('alert')).toBeOnTheScreen()
    await stale.unmount()
  })
  it('requires an accessible explanation before dismissing', async () => {
    const i18n = await initMobileI18n('en')
    const row = { ...recurringItemFixture, status: 'candidate' as const }
    let finishDismiss!: (result: 'success') => void
    const onDismiss = jest.fn().mockReturnValue(new Promise((resolve) => { finishDismiss = resolve }))
    const view = await render(<I18nextProvider i18n={i18n}><RecurringScreen state={{ status: 'loaded', rows: mapRecurringItems({ items: [row] }), summary: mapRecurringSummary(recurringSummaryFixture), refreshing: false }} onBack={jest.fn()} onRefresh={jest.fn()} onDismiss={onDismiss} /></I18nextProvider>)
    fireEvent.press(view.getByRole('button', { name: 'Dismiss' }))
    expect(onDismiss).not.toHaveBeenCalled()
    await waitFor(() => expect(view.getByRole('header', { name: 'Dismiss this candidate?' })).toBeOnTheScreen())
    expect(view.getByText(/removed from recurring review and detection results/)).toBeOnTheScreen()
    fireEvent.press(view.getByRole('button', { name: 'Dismiss candidate' }))
    await waitFor(() => expect(onDismiss).toHaveBeenCalledWith(7))
    await act(async () => { finishDismiss('success'); await Promise.resolve() })
    await waitFor(() => expect(view.queryByText('Dismiss this candidate?')).toBeNull())
  })
  it('offers restore only for dismissed rows and calls onRestore directly without a confirmation step', async () => {
    const i18n = await initMobileI18n('en')
    const onRestore = jest.fn().mockResolvedValue('success')
    const rows = mapRecurringItems({ items: [{ ...recurringItemFixture, status: 'dismissed' }, { ...recurringItemFixture, recurringSeriesKey: 8, status: 'confirmed' }] })
    const view = await render(<I18nextProvider i18n={i18n}><RecurringScreen state={{ status: 'loaded', rows, summary: mapRecurringSummary(recurringSummaryFixture), refreshing: false }} onBack={jest.fn()} onRefresh={jest.fn()} onRestore={onRestore} /></I18nextProvider>)
    expect(view.getAllByRole('button', { name: 'Restore' })).toHaveLength(1)
    fireEvent.press(view.getByRole('button', { name: 'Restore' }))
    await waitFor(() => expect(onRestore).toHaveBeenCalledWith(7))
  })
  it('confirms directly without a confirmation step', async () => {
    const i18n = await initMobileI18n('en')
    const onConfirm = jest.fn().mockResolvedValue('success')
    const view = await render(<I18nextProvider i18n={i18n}><RecurringScreen state={{ status: 'loaded', rows: mapRecurringItems({ items: [{ ...recurringItemFixture, status: 'candidate' }] }), summary: mapRecurringSummary(recurringSummaryFixture), refreshing: false }} onBack={jest.fn()} onRefresh={jest.fn()} onConfirm={onConfirm} /></I18nextProvider>)
    fireEvent.press(view.getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith(7))
    expect(view.queryByText('Dismiss this candidate?')).toBeNull()
  })
  it('edits metadata with labelled fields and supports a nullable category', async () => {
    const i18n = await initMobileI18n('en')
    let finishUpdate!: (result: 'success') => void
    const onUpdate = jest.fn().mockReturnValue(new Promise((resolve) => { finishUpdate = resolve }))
    const view = await render(<I18nextProvider i18n={i18n}><RecurringScreen state={{ status: 'loaded', rows: mapRecurringItems({ items: [{ ...recurringItemFixture, amountType: 'variable', expectedAmount: null, expectedAmountMin: 10, expectedAmountMax: 20 }] }), summary: mapRecurringSummary(recurringSummaryFixture), refreshing: false }} categories={[{ id: 4, name: 'Housing' }]} onBack={jest.fn()} onRefresh={jest.fn()} onUpdate={onUpdate} /></I18nextProvider>)
    fireEvent.press(view.getByRole('button', { name: 'Edit details' }))
    await waitFor(() => expect(view.getByLabelText('Display name')).toBeOnTheScreen())
    fireEvent.changeText(view.getByLabelText('Minimum amount'), '10')
    await waitFor(() => expect(view.getByLabelText('Minimum amount').props.value).toBe('10'))
    fireEvent.press(view.getByRole('radio', { name: 'No category' }))
    await waitFor(() => expect(view.getByRole('radio', { name: 'No category' }).props.accessibilityState.checked).toBe(true))
    fireEvent.press(view.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith(7, expect.objectContaining({ categoryKey: null, expectedAmount: null, expectedAmountMin: 10, expectedAmountMax: 20 })))
    await act(async () => { finishUpdate('success'); await Promise.resolve() })
  })
  it('disables known demo writes and exposes a non-color explanation', async () => {
    const i18n = await initMobileI18n('en')
    const rows = mapRecurringItems({ items: [{ ...recurringItemFixture, status: 'candidate' }] })
    const view = await render(<I18nextProvider i18n={i18n}><RecurringScreen state={{ status: 'loaded', rows, summary: mapRecurringSummary(recurringSummaryFixture), refreshing: false }} demoReadOnly onBack={jest.fn()} onRefresh={jest.fn()} /></I18nextProvider>)
    expect(view.getByRole('alert')).toHaveTextContent(/Demo profiles are read-only/)
    expect(view.getByRole('button', { name: 'Confirm' })).toBeDisabled()
    expect(view.getByRole('button', { name: 'Edit details' })).toBeDisabled()
    expect(view.getByRole('button', { name: 'Scan again' })).toBeDisabled()
  })
  it('explains scan effects before one submission and reports localized counts', async () => {
    const i18n = await initMobileI18n('en')
    const onScan = jest.fn().mockResolvedValue({ status: 'success', counts: { created: 2, updated: 1, skipped: 3 } })
    const state = { status: 'loaded' as const, rows: [], summary: mapRecurringSummary(recurringSummaryFixture), refreshing: false }
    const view = await render(<I18nextProvider i18n={i18n}><RecurringScreen state={state} onBack={jest.fn()} onRefresh={jest.fn()} onScan={onScan} /></I18nextProvider>)
    fireEvent.press(view.getByRole('button', { name: 'Scan again' }))
    expect(onScan).not.toHaveBeenCalled()
    await waitFor(() => expect(view.getByRole('header', { name: 'Scan recurring activity again?' })).toBeOnTheScreen())
    expect(view.getByText(/may create new recurring candidates or update existing candidates/)).toBeOnTheScreen()
    await act(async () => { fireEvent.press(view.getByRole('button', { name: 'Start scan' })); await Promise.resolve() })
    expect(onScan).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(view.getByText('Scan complete · 2 created · 1 updated · 3 skipped')).toBeOnTheScreen())
  })
  it('shows the unknown-status refresh gate without offering a blind resubmit', async () => {
    const i18n = await initMobileI18n('en')
    const rows = mapRecurringItems({ items: [{ ...recurringItemFixture, status: 'candidate' }] })
    const view = await render(<I18nextProvider i18n={i18n}><RecurringScreen state={{ status: 'loaded', rows, summary: mapRecurringSummary(recurringSummaryFixture), refreshing: false }} scanNeedsRefresh onBack={jest.fn()} onRefresh={jest.fn()} onScan={jest.fn()} /></I18nextProvider>)
    expect(view.getByRole('alert')).toHaveTextContent(/may have completed, but its result could not be confirmed/)
    expect(view.getByRole('button', { name: 'Scan again' })).toBeDisabled()
    expect(view.getByRole('button', { name: 'Confirm' })).toBeDisabled()
    expect(view.getByRole('button', { name: 'Dismiss' })).toBeDisabled()
    expect(view.getByRole('button', { name: 'Edit details' })).toBeDisabled()
  })
  it('disables row writes during a scan and marks only the scan as busy', async () => {
    const i18n = await initMobileI18n('en')
    const rows = mapRecurringItems({ items: [{ ...recurringItemFixture, status: 'candidate' }] })
    const view = await render(<I18nextProvider i18n={i18n}><RecurringScreen state={{ status: 'loaded', rows, summary: mapRecurringSummary(recurringSummaryFixture), refreshing: false }} pending={{ kind: 'detect' }} onBack={jest.fn()} onRefresh={jest.fn()} /></I18nextProvider>)
    expect(view.getByRole('button', { name: 'Scanning' }).props.accessibilityState).toEqual({ disabled: true, busy: true })
    expect(view.getByRole('button', { name: 'Confirm' })).toBeDisabled()
    expect(view.getByRole('button', { name: 'Edit details' })).toBeDisabled()
  })
})
