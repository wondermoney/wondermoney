import { fireEvent, render, renderHook } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { householdMembersModel } from '@/features/household/member-attribution'
import { initMobileI18n } from '@/lib/i18n'
import { themeTokens } from '@/theme/tokens'

import { ReportFilterPanel } from './report-filter-panel'
import { ReportFiltersBar } from './report-filters-bar'
import { useReportFilters } from './use-report-filters'

const palette = themeTokens.colors.light
const filterOptions = { accounts: [{ id: '1', label: 'Checking' }], categories: [{ id: '9', label: 'Groceries' }], merchants: [{ id: '5', label: 'Amazon' }], currencies: ['EUR', 'USD'] }

const householdOf = (count: number) => householdMembersModel({
  members: [
    { appuserKey: 11, emailAddress: 'ana@example.test', firstName: 'Ana', role: 'owner' as const },
    { appuserKey: 12, emailAddress: 'bruno@example.test', firstName: 'Bruno', role: 'member' as const },
  ].slice(0, count),
  maxMembers: 6,
  pendingInvites: [],
  viewerAppuserKey: 11,
})
const twoMembers = householdOf(2)

async function renderPanel(options: React.ComponentProps<typeof ReportFilterPanel>['filterOptions'] = filterOptions) {
  const i18n = await initMobileI18n('en')
  const filterStateHook = await renderHook(() => useReportFilters())
  const view = await render(
    <I18nextProvider i18n={i18n}>
      <ReportFilterPanel filterState={filterStateHook.result.current} filterOptions={options} palette={palette} />
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

  it('opens the filter sheet with every filter control on press', async () => {
    const { view } = await renderPanel()
    await fireEvent.press(view.getByRole('button', { name: 'Filters' }))
    expect(view.getByRole('button', { name: /^Accounts,/ })).toBeTruthy()
    expect(view.getByRole('button', { name: /^Categories,/ })).toBeTruthy()
    expect(view.getByRole('button', { name: /^Merchants,/ })).toBeTruthy()
    expect(view.getByRole('button', { name: /^Currency,/ })).toBeTruthy()
    expect(view.getByRole('switch', { name: 'Include pending transactions' })).toBeTruthy()
    expect(view.getByRole('switch', { name: 'Include transfers' })).toBeTruthy()
  })

  it('offers no member filter in a household of one', async () => {
    const { view } = await renderPanel({ ...filterOptions, members: householdOf(1) })
    await fireEvent.press(view.getByRole('button', { name: 'Filters' }))
    expect(view.queryByRole('button', { name: /^Member,/ })).toBeNull()
  })

  it('filters every report by one member or Shared', async () => {
    const { view, filterStateHook } = await renderPanel({ ...filterOptions, members: twoMembers })
    await fireEvent.press(view.getByRole('button', { name: 'Filters' }))
    await fireEvent.press(view.getByRole('button', { name: /^Member, Everyone/ }))
    await fireEvent.press(view.getByRole('radio', { name: 'Shared' }))
    expect(filterStateHook.result.current.filters.memberKeys).toEqual(['shared'])
    expect(filterStateHook.result.current.activeFilterCount).toBe(1)
  })

  it('toggling include-pending updates the underlying filter state', async () => {
    const { view, filterStateHook } = await renderPanel()
    await fireEvent.press(view.getByRole('button', { name: 'Filters' }))
    await fireEvent.press(view.getByRole('switch', { name: 'Include pending transactions' }))
    expect(filterStateHook.result.current.fields.includePending).toBe(true)
  })

  it('the bar\'s reset icon clears the fields and the period', async () => {
    const i18n = await initMobileI18n('en')
    const filterStateHook = await renderHook(() => useReportFilters())
    const onSelectPreset = jest.fn()
    const bar = await render(
      <I18nextProvider i18n={i18n}>
        <ReportFiltersBar filterOptions={filterOptions} filterState={filterStateHook.result.current} onSelectPreset={onSelectPreset} preset="last6Months" />
      </I18nextProvider>,
    )
    await fireEvent.press(bar.getByRole('button', { name: 'Filters' }))
    await fireEvent.press(bar.getByRole('switch', { name: 'Include transfers' }))
    expect(filterStateHook.result.current.fields.includeTransfers).toBe(true)
    await fireEvent.press(bar.getByRole('button', { name: 'Close filters' }))
    await fireEvent.press(bar.getByRole('button', { name: 'Reset filters' }))
    expect(filterStateHook.result.current.fields.includeTransfers).toBe(false)
    expect(onSelectPreset).toHaveBeenCalledWith('last3Months')
  })
})
