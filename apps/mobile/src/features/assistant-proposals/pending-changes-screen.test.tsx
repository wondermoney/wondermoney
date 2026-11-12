import { fireEvent, render } from '@testing-library/react-native'
import type { ComponentProps } from 'react'
import { I18nextProvider } from 'react-i18next'

import { initMobileI18n } from '@/lib/i18n'

import { PendingChangesScreen } from './pending-changes-screen'
import type { ProposalListItem } from './proposals-view-model'

jest.mock('expo-router', () => ({ useRouter: () => ({ back: jest.fn(), canGoBack: () => true, replace: jest.fn() }) }))

const proposal = (overrides: Partial<ProposalListItem> = {}): ProposalListItem => ({
  id: 7,
  title: 'Mark 1 transaction as reviewed',
  source: 'From the assistant',
  expires: 'Expires Nov 17, 2026',
  rows: [{ key: '1-reviewed', label: 'Corner shop', date: 'Nov 8, 2026', before: 'Not reviewed', after: 'Reviewed' }],
  unavailable: null,
  ...overrides,
})

async function renderScreen(props: Partial<ComponentProps<typeof PendingChangesScreen>> = {}) {
  const i18n = await initMobileI18n('en')
  return render(
    <I18nextProvider i18n={i18n}>
      <PendingChangesScreen
        onApply={jest.fn()}
        onDismiss={jest.fn()}
        onRetry={jest.fn()}
        state={{ status: 'loaded', proposals: [proposal()] }}
        {...props}
      />
    </I18nextProvider>,
  )
}

describe('PendingChangesScreen', () => {
  it('shows a proposal with its diff and hands Apply and Dismiss its id', async () => {
    const onApply = jest.fn()
    const onDismiss = jest.fn()
    const view = await renderScreen({ onApply, onDismiss })

    expect(view.getByText('Mark 1 transaction as reviewed')).toBeOnTheScreen()
    expect(view.getByText('From the assistant · Expires Nov 17, 2026')).toBeOnTheScreen()
    expect(view.getByLabelText('Corner shop: Not reviewed to Reviewed')).toBeOnTheScreen()

    await fireEvent.press(view.getByRole('button', { name: 'Apply: Mark 1 transaction as reviewed' }))
    await fireEvent.press(view.getByRole('button', { name: 'Dismiss: Mark 1 transaction as reviewed' }))
    expect(onApply).toHaveBeenCalledWith(7)
    expect(onDismiss).toHaveBeenCalledWith(7)
  })

  it('keeps the other proposals inert while one decision is in flight', async () => {
    const onApply = jest.fn()
    const view = await renderScreen({
      onApply,
      pendingId: 7,
      state: { status: 'loaded', proposals: [proposal(), proposal({ id: 8, title: 'Update the note on a transaction' })] },
    })

    await fireEvent.press(view.getByRole('button', { name: 'Apply: Update the note on a transaction' }))
    expect(onApply).not.toHaveBeenCalled()
  })

  it('says how many transactions in a proposal can no longer be shown', async () => {
    const view = await renderScreen({ state: { status: 'loaded', proposals: [proposal({ unavailable: "1 more transaction can't be shown: you can no longer see it." })] } })

    expect(view.getByText("1 more transaction can't be shown: you can no longer see it.")).toBeOnTheScreen()
  })

  it('offers a retry when the list cannot load', async () => {
    const onRetry = jest.fn()
    const view = await renderScreen({ onRetry, state: { status: 'error' } })

    expect(view.getByText("Couldn't load pending changes")).toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Retry' }))
    expect(onRetry).toHaveBeenCalled()
  })

  it('shows only the AI-hidden notice when the person hid AI', async () => {
    const view = await renderScreen({ state: { status: 'ai-hidden' } })

    expect(view.getByText(/AI features are hidden for your account/u)).toBeOnTheScreen()
    expect(view.queryByRole('button', { name: /^Apply/u })).toBeNull()
  })
})
