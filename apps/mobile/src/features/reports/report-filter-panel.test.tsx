import { fireEvent, render, renderHook } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { initMobileI18n } from '@/lib/i18n'
import { themeTokens } from '@/theme/tokens'

import { ReportFilterPanel } from './report-filter-panel'
import { useReportFilters } from './use-report-filters'

const palette = themeTokens.colors.light
const filterOptions = { accounts: [{ id: '1', label: 'Checking' }], categories: [{ id: '9', label: 'Groceries' }], merchants: [{ id: '5', label: 'Amazon' }], currencies: ['EUR', 'USD'] }

async function renderPanel() {
  const i18n = await initMobileI18n('en')
  const filterStateHook = await renderHook(() => useReportFilters())
  const view = await render(
    <I18nextProvider i18n={i18n}>
      <ReportFilterPanel filterState={filterStateHook.result.current} filterOptions={filterOptions} palette={palette} />
    </I18nextProvider>,
  )
  return { view, filterStateHook }
}

describe('ReportFilterPanel', () => {
  it('shows no active-count badge and the plain trigger label with no filters set', async () => {
    const { view } = await renderPanel()
    expect(view.getByRole('button', { name: 'Filters' })).toBeTruthy()
    expect(view.queryByText('3')).toBeNull()
  })

  it('expands to reveal every filter control on press', async () => {
    const { view } = await renderPanel()
    await fireEvent.press(view.getByRole('button', { name: 'Filters' }))
    expect(view.getByRole('button', { name: /^Accounts,/ })).toBeTruthy()
    expect(view.getByRole('button', { name: /^Categories,/ })).toBeTruthy()
    expect(view.getByRole('button', { name: /^Merchants,/ })).toBeTruthy()
    expect(view.getByRole('button', { name: /^Currency,/ })).toBeTruthy()
    expect(view.getByRole('switch', { name: 'Include pending transactions' })).toBeTruthy()
    expect(view.getByRole('switch', { name: 'Include transfers' })).toBeTruthy()
  })

  it('toggling include-pending updates the underlying filter state', async () => {
    const { view, filterStateHook } = await renderPanel()
    await fireEvent.press(view.getByRole('button', { name: 'Filters' }))
    await fireEvent.press(view.getByRole('switch', { name: 'Include pending transactions' }))
    expect(filterStateHook.result.current.fields.includePending).toBe(true)
  })

  it('resets fields via the reset action inside the expanded panel', async () => {
    const { view, filterStateHook } = await renderPanel()
    await fireEvent.press(view.getByRole('button', { name: 'Filters' }))
    await fireEvent.press(view.getByRole('switch', { name: 'Include transfers' }))
    expect(filterStateHook.result.current.fields.includeTransfers).toBe(true)
    await fireEvent.press(view.getByRole('button', { name: 'Reset filters' }))
    expect(filterStateHook.result.current.fields.includeTransfers).toBe(false)
  })
})
