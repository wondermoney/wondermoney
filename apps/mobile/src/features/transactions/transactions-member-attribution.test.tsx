import { fireEvent, render } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { householdMembersModel, type HouseholdMembersModel } from '@/features/household/member-attribution'
import { initMobileI18n } from '@/lib/i18n'

import { transactionFixture } from './test-fixtures'
import type { TransactionDto } from './transactions-contract'
import { TransactionsScreen } from './transactions-screen'
import { mapTransactions } from './transactions-view-model'

jest.mock('@/components/ui/date-field', () => jest.requireActual('./test-date-field'))
jest.mock('./transaction-attachments-section', () => ({ TransactionAttachmentsSection: () => null }))

const household = (role: 'owner' | 'viewer' = 'owner', count = 2) => householdMembersModel({
  members: [
    { appuserKey: 11, emailAddress: 'ana@example.test', firstName: 'Ana', role },
    { appuserKey: 12, emailAddress: 'bruno@example.test', firstName: ' ', role: 'member' as const },
  ].slice(0, count),
  maxMembers: 6,
  pendingInvites: [],
  viewerAppuserKey: 11,
})

const followsAccount: TransactionDto = { ...transactionFixture, attribution: { appuserKey: 11, displayName: 'Ana', overridden: false } }
const sharedRow: TransactionDto = { ...transactionFixture, transactionKey: 42, transactionMerchantKey: { name: 'Bakery' }, attribution: { appuserKey: null, displayName: null, overridden: true } }

async function renderScreen({ members, transactions = [followsAccount, sharedRow], perAccount = false, readOnlyAccountIds }: { members: HouseholdMembersModel; transactions?: TransactionDto[]; perAccount?: boolean; readOnlyAccountIds?: ReadonlySet<number> }) {
  const i18n = await initMobileI18n('en')
  const onFiltersChange = jest.fn()
  const onSetSpentBy = jest.fn().mockResolvedValue('success')
  const view = await render(
    <I18nextProvider i18n={i18n}>
      <TransactionsScreen
        accountAttributions={new Map([[7, { appuserKey: 11, displayName: 'Ana' }]])}
        filters={{}}
        members={members}
        onBack={jest.fn()}
        onFiltersChange={onFiltersChange}
        onMarkReviewed={jest.fn()}
        onRefresh={jest.fn()}
        onSetSpentBy={onSetSpentBy}
        perAccount={perAccount}
        readOnlyAccountIds={readOnlyAccountIds}
        state={{ status: 'loaded', transactions: mapTransactions({ transactions }), refreshing: false }}
      />
    </I18nextProvider>,
  )
  return { view, onFiltersChange, onSetSpentBy }
}

async function openSpentBy(view: Awaited<ReturnType<typeof renderScreen>>['view'], name: string) {
  await fireEvent.press(view.getByRole('button', { name: `Actions for ${name}` }))
  await fireEvent.press(view.getByRole('menuitem', { name: 'Change spent by' }))
}

describe('transactions member attribution', () => {
  it('marks each row with its member\'s initial or Shared in a household of more than one', async () => {
    const { view } = await renderScreen({ members: household() })
    const badges = view.getAllByTestId('transaction-member-badge')
    expect(badges).toHaveLength(2)
    expect(view.getByLabelText('Attributed to Ana')).toBeOnTheScreen()
    expect(view.getByText('A')).toBeOnTheScreen()
    expect(view.getByText('Shared')).toBeOnTheScreen()
  })

  it('shows no member badge, filter or "Spent by" in a household of one', async () => {
    const { view } = await renderScreen({ members: household('owner', 1) })
    expect(view.queryByTestId('transaction-member-badge')).toBeNull()
    await fireEvent.press(view.getByRole('button', { name: 'Filters' }))
    expect(view.queryByRole('button', { name: /^Member,/ })).toBeNull()
    await fireEvent.press(view.getByRole('button', { name: 'Actions for Corner shop' }))
    expect(view.queryByRole('menuitem', { name: 'Change spent by' })).toBeNull()
  })

  it('filters the ledger by one member or Shared, as a server filter', async () => {
    const { view, onFiltersChange } = await renderScreen({ members: household() })
    await fireEvent.press(view.getByRole('button', { name: 'Filters' }))
    await fireEvent.press(view.getByRole('button', { name: /^Member, Everyone/ }))
    // A member without a first name is named by their email address.
    await fireEvent.press(view.getByRole('radio', { name: 'bruno@example.test' }))
    expect(onFiltersChange).toHaveBeenLastCalledWith(expect.objectContaining({ memberKeys: [12] }))
  })

  it('offers no member filter on one account\'s ledger', async () => {
    const { view } = await renderScreen({ members: household(), perAccount: true })
    await fireEvent.press(view.getByRole('button', { name: 'Filters' }))
    expect(view.queryByRole('button', { name: /^Member,/ })).toBeNull()
  })

  it('sets "Spent by" to a member, to Shared, or back to the account default', async () => {
    const { view, onSetSpentBy } = await renderScreen({ members: household() })

    await openSpentBy(view, 'Corner shop')
    // The account default names whose the account is.
    expect(view.getByRole('radio', { name: 'Account default (Ana)' })).toBeChecked()
    await fireEvent.press(view.getByRole('radio', { name: 'bruno@example.test' }))
    expect(onSetSpentBy).toHaveBeenLastCalledWith(41, 12)

    await openSpentBy(view, 'Corner shop')
    await fireEvent.press(view.getByRole('radio', { name: 'Shared' }))
    expect(onSetSpentBy).toHaveBeenLastCalledWith(41, 'shared')

    await openSpentBy(view, 'Bakery')
    expect(view.getByRole('radio', { name: 'Shared' })).toBeChecked()
    await fireEvent.press(view.getByRole('radio', { name: 'Account default (Ana)' }))
    expect(onSetSpentBy).toHaveBeenLastCalledWith(42, null)
  })

  it('offers no "Spent by" on an account shared with the viewer to view only', async () => {
    const { view } = await renderScreen({ members: household(), readOnlyAccountIds: new Set([7]) })
    await fireEvent.press(view.getByRole('button', { name: 'Actions for Corner shop' }))
    expect(view.queryByRole('menuitem', { name: 'Change spent by' })).toBeNull()
    await fireEvent.press(view.getByRole('button', { name: /^Corner shop,/ }))
    expect(view.queryByRole('button', { name: 'Spent by' })).toBeNull()
  })

  it('offers a household viewer no "Spent by"', async () => {
    const { view } = await renderScreen({ members: household('viewer') })
    await fireEvent.press(view.getByRole('button', { name: 'Actions for Corner shop' }))
    expect(view.queryByRole('menuitem', { name: 'Change spent by' })).toBeNull()
    // They still see whose each row is.
    expect(view.getAllByTestId('transaction-member-badge')).toHaveLength(2)
  })
})
