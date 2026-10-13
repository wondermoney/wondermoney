import { fireEvent, render } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { initMobileI18n } from '@/lib/i18n'

import { BudgetAccountsScreen, type BudgetAccountOption } from './budget-accounts-screen'

const accounts: readonly BudgetAccountOption[] = [
  { id: 9, name: 'Daily account' },
  { id: 10, name: null },
  { id: 11, name: 'Savings' },
]

const renderScreen = async (overrides: Partial<React.ComponentProps<typeof BudgetAccountsScreen>> = {}) => {
  const i18n = await initMobileI18n('en')
  const props: React.ComponentProps<typeof BudgetAccountsScreen> = {
    status: 'ready',
    accounts,
    linkedIds: [9],
    pending: false,
    failure: null,
    onBack: jest.fn(),
    onRefresh: jest.fn(),
    onSubmit: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  }
  return { props, view: await render(<I18nextProvider i18n={i18n}><BudgetAccountsScreen {...props} /></I18nextProvider>) }
}

describe('BudgetAccountsScreen', () => {
  it('pre-checks currently linked accounts and labels an unnamed account honestly', async () => {
    const { view } = await renderScreen()
    expect(view.getByRole('checkbox', { name: 'Daily account' }).props.accessibilityState.checked).toBe(true)
    expect(view.getByRole('checkbox', { name: 'Savings' }).props.accessibilityState.checked).toBe(false)
    expect(view.getByRole('checkbox', { name: 'Unnamed account' }).props.accessibilityState.checked).toBe(false)
  })

  it('disables save until the selection actually changes, then submits the full new set', async () => {
    const submit = jest.fn().mockResolvedValue(undefined)
    const { view } = await renderScreen({ onSubmit: submit })
    expect(view.getByRole('button', { name: 'Save linked accounts' }).props.accessibilityState.disabled).toBe(true)
    await fireEvent.press(view.getByRole('checkbox', { name: 'Savings' }))
    expect(view.getByRole('button', { name: 'Save linked accounts' }).props.accessibilityState.disabled).toBe(false)
    await fireEvent.press(view.getByRole('button', { name: 'Save linked accounts' }))
    expect(submit).toHaveBeenCalledWith(expect.arrayContaining([9, 11]))
    expect(submit.mock.calls[0][0]).toHaveLength(2)
  })

  it('toggling back to the original selection re-disables save', async () => {
    const { view } = await renderScreen()
    await fireEvent.press(view.getByRole('checkbox', { name: 'Savings' }))
    await fireEvent.press(view.getByRole('checkbox', { name: 'Savings' }))
    expect(view.getByRole('button', { name: 'Save linked accounts' }).props.accessibilityState.disabled).toBe(true)
  })

  it('allows unlinking every account down to none', async () => {
    const submit = jest.fn().mockResolvedValue(undefined)
    const { view } = await renderScreen({ onSubmit: submit })
    await fireEvent.press(view.getByRole('checkbox', { name: 'Daily account' }))
    await fireEvent.press(view.getByRole('button', { name: 'Save linked accounts' }))
    expect(submit).toHaveBeenCalledWith([])
  })

  it('shows a scoped failure and locks the list while pending', async () => {
    const { view } = await renderScreen({ failure: 'network-ambiguous', pending: true })
    expect(view.getByRole('alert')).toHaveTextContent(/result is unknown.*not retry automatically/i)
    expect(view.getByRole('checkbox', { name: 'Daily account' }).props.accessibilityState.disabled).toBe(true)
    expect(view.getByRole('button', { name: 'Saving…' }).props.accessibilityState.disabled).toBe(true)
  })

  it('explains an empty account list without inventing accounts', async () => {
    const { view } = await renderScreen({ accounts: [], linkedIds: [] })
    expect(view.getByText('No accounts are available to link')).toBeOnTheScreen()
  })

  it.each(['loading', 'error'] as const)('handles the %s state', async (status) => {
    const view = (await renderScreen({ status })).view
    expect(view.toJSON()).not.toBeNull()
  })
})
