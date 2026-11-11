import { fireEvent, render } from '@testing-library/react-native'
import type { ComponentProps } from 'react'
import { Alert } from 'react-native'
import { I18nextProvider } from 'react-i18next'

import { initMobileI18n } from '@/lib/i18n'

import { RulesScreen } from './rules-screen'
import type { RuleListItem } from './rules-view-model'

const rule = (overrides: Partial<RuleListItem> = {}): RuleListItem => ({
  id: 4,
  name: 'Netflix',
  active: true,
  position: 0,
  summary: 'Description contains NETFLIX, set category Entertainment',
  editable: true,
  stopProcessing: false,
  ...overrides,
})

const renderScreen = async (props: Partial<ComponentProps<typeof RulesScreen>> = {}) => {
  const i18n = await initMobileI18n('en')
  const view = await render(
    <I18nextProvider i18n={i18n}>
      <RulesScreen
        onBack={jest.fn()}
        onDelete={jest.fn()}
        onOpenRule={jest.fn()}
        onRetry={jest.fn()}
        onToggleActive={jest.fn()}
        state={{ status: 'loaded', rules: [rule()] }}
        {...props}
      />
    </I18nextProvider>,
  )
  return view
}

describe('RulesScreen', () => {
  beforeEach(() => jest.restoreAllMocks())

  it('lists the rules in run order with their summary, and toggles one', async () => {
    const toggle = jest.fn()
    const view = await renderScreen({
      onToggleActive: toggle,
      state: {
        status: 'loaded',
        rules: [rule(), rule({ id: 5, name: 'Coffee', position: 1, active: false, summary: 'Merchant is Corner shop, set category Food' })],
      },
    })

    expect(view.getByText('Netflix')).toBeOnTheScreen()
    expect(view.getByText('Description contains NETFLIX, set category Entertainment')).toBeOnTheScreen()
    expect(view.getByText('Coffee')).toBeOnTheScreen()
    // Inactive is said in words, not only by the switch's position.
    expect(view.getByText('Off')).toBeOnTheScreen()

    await fireEvent(view.getByRole('switch', { name: 'Coffee, active' }), 'valueChange', true)
    expect(toggle.mock.calls).toEqual([[5, true]])
  })

  it('opens an editable rule and says where a rule outside the subset is edited', async () => {
    const open = jest.fn()
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(jest.fn())
    const view = await renderScreen({
      onOpenRule: open,
      state: { status: 'loaded', rules: [rule(), rule({ id: 6, name: 'Accounts', editable: false, summary: "a condition this app doesn't show, hide" })] },
    })

    await fireEvent.press(view.getByRole('button', { name: 'Netflix, Description contains NETFLIX, set category Entertainment' }))
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ id: 4 }))

    await fireEvent.press(view.getByRole('button', { name: "Accounts, a condition this app doesn't show, hide, Edit on web" }))
    expect(open).toHaveBeenCalledTimes(1)
    expect(alert).toHaveBeenCalledWith("This rule can't be edited here", "It uses fields the app doesn't edit yet. Open the web app to change it.")
    expect(view.getByText('Edit on web')).toBeOnTheScreen()
  })

  it('deletes only after the confirmation', async () => {
    const remove = jest.fn()
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      buttons?.find((button) => button.style === 'destructive')?.onPress?.()
    })
    const view = await renderScreen({ onDelete: remove })

    await fireEvent.press(view.getByRole('button', { name: 'Actions for Netflix' }))
    await fireEvent.press(view.getByRole('menuitem', { name: 'Delete' }))

    expect(alert).toHaveBeenCalledWith('Delete "Netflix"?', 'The rule stops running. Transactions it already changed stay as they are.', expect.any(Array))
    expect(remove).toHaveBeenCalledWith(4)
  })

  it('keeps the list usable when a write is blocked or the list is empty', async () => {
    const empty = await renderScreen({ state: { status: 'loaded', rules: [] } })
    expect(empty.getByText('No rules yet. Open a transaction and choose Create rule to categorize, rename or tag transactions automatically.')).toBeOnTheScreen()

    const blocked = await renderScreen({ demoLocked: true, writeBlocked: true })
    expect(blocked.getByRole('alert')).toHaveTextContent('Demo profiles are read-only. Rule changes are unavailable for this sign-in.')
    expect(blocked.getByRole('switch', { name: 'Netflix, active' })).toBeDisabled()
  })

  it('shows the loading and failure states', async () => {
    const loading = await renderScreen({ state: { status: 'loading' } })
    expect(loading.getByRole('progressbar', { name: 'Loading rules' })).toBeOnTheScreen()

    const failed = await renderScreen({ state: { status: 'error' } })
    expect(failed.getByText('Could not load rules')).toBeOnTheScreen()
    expect(failed.getByRole('button', { name: 'Retry' })).toBeOnTheScreen()
  })
})
