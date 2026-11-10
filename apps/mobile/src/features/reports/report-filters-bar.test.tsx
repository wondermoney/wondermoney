import { fireEvent, render } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { initMobileI18n } from '@/lib/i18n'
import { inTimeZone } from '@/test/time-zone'

import { customReportDateRange, type ReportDatePreset } from './report-date-presets'
import { ReportFiltersBar } from './report-filters-bar'

async function renderBar(preset: ReportDatePreset, onSelectPreset = jest.fn()) {
  const i18n = await initMobileI18n('en')
  const view = await render(
    <I18nextProvider i18n={i18n}>
      <ReportFiltersBar onSelectPreset={onSelectPreset} preset={preset} />
    </I18nextProvider>,
  )
  return { view, onSelectPreset }
}

async function openCustomRange(view: Awaited<ReturnType<typeof renderBar>>['view'], trigger: string) {
  await fireEvent.press(view.getByRole('button', { name: `Date range, ${trigger}` }))
  await fireEvent.press(view.getByRole('radio', { name: 'Custom range' }))
}

describe('ReportFiltersBar custom range', () => {
  inTimeZone('America/New_York')

  it('applies the two picked days as the report period', async () => {
    const { view, onSelectPreset } = await renderBar('last3Months')
    await openCustomRange(view, 'Last 3 months')
    await fireEvent.changeText(view.getByLabelText('From'), '2026-08-03')
    await fireEvent.changeText(view.getByLabelText('To'), '2026-08-17')
    await fireEvent.press(view.getByRole('button', { name: 'Apply' }))
    expect(onSelectPreset).toHaveBeenCalledWith(customReportDateRange('2026-08-03', '2026-08-17'))
  })

  it('rejects a start after the end and leaves the period alone', async () => {
    const { view, onSelectPreset } = await renderBar('last3Months')
    await openCustomRange(view, 'Last 3 months')
    await fireEvent.changeText(view.getByLabelText('From'), '2026-08-17')
    await fireEvent.changeText(view.getByLabelText('To'), '2026-08-03')
    await fireEvent.press(view.getByRole('button', { name: 'Apply' }))
    expect(view.getByRole('alert', { name: /must not be after/ })).toBeOnTheScreen()
    expect(onSelectPreset).not.toHaveBeenCalled()
  })

  it('shows the chosen range as the filter label', async () => {
    const { view } = await renderBar(customReportDateRange('2026-08-03', '2026-08-17'))
    expect(view.getByRole('button', { name: 'Date range, Aug 3, 2026 – Aug 17, 2026' })).toBeOnTheScreen()
  })

  it('still switches to a named preset', async () => {
    const { view, onSelectPreset } = await renderBar('last3Months')
    await fireEvent.press(view.getByRole('button', { name: 'Date range, Last 3 months' }))
    await fireEvent.press(view.getByRole('radio', { name: 'Last 6 months' }))
    expect(onSelectPreset).toHaveBeenCalledWith('last6Months')
  })
})
