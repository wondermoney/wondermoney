import { fireEvent, render } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'
import { Alert } from 'react-native'

import { initMobileI18n } from '@/lib/i18n'

import { PasskeysSection, type PasskeysSectionProps } from './passkeys-section'

const laptop = { id: 'pk-1', name: 'Laptop', aaguid: null, createdAt: '2026-11-01T10:00:00.000Z', lastUsedAt: null }
const synced = { id: 'pk-2', name: null, aaguid: 'ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4', createdAt: '2026-11-02T10:00:00.000Z', lastUsedAt: '2026-11-03T10:00:00.000Z' }
const unnamed = { id: 'pk-3', name: null, aaguid: '00000000-0000-0000-0000-000000000000', createdAt: null, lastUsedAt: null }

async function renderSection(overrides: Partial<PasskeysSectionProps> = {}) {
  const i18n = await initMobileI18n('en')
  const props: PasskeysSectionProps = {
    status: 'ready',
    passkeys: [],
    canAdd: true,
    adding: false,
    deletingId: null,
    notice: null,
    locale: 'en-US',
    onRetry: jest.fn(),
    onAdd: jest.fn(),
    onDelete: jest.fn(),
    ...overrides,
  }
  const view = await render(<I18nextProvider i18n={i18n}><PasskeysSection {...props} /></I18nextProvider>)
  return { view, props }
}

describe('PasskeysSection', () => {
  afterEach(() => jest.restoreAllMocks())

  it('lists each passkey with its name, or its password manager\'s, and its dates', async () => {
    const { view } = await renderSection({ passkeys: [laptop, synced, unnamed] })

    expect(view.getByText('Laptop')).toBeOnTheScreen()
    expect(view.getByText('Google Password Manager')).toBeOnTheScreen()
    expect(view.getByText('Passkey')).toBeOnTheScreen()
    expect(view.getByText('Added Nov 1, 2026')).toBeOnTheScreen()
    expect(view.getByText('Last used Nov 3, 2026')).toBeOnTheScreen()
    expect(view.getAllByText('Never used')).toHaveLength(2)
  })

  it('says when there are none yet, and offers to add one on a device that can', async () => {
    const onAdd = jest.fn()
    const { view } = await renderSection({ onAdd })

    expect(view.getByText("You haven't added a passkey yet.")).toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Add a passkey' }))
    expect(onAdd).toHaveBeenCalledTimes(1)
  })

  it('offers no Add where the phone cannot use this server\'s passkeys, but still lists and deletes them', async () => {
    const { view } = await renderSection({ canAdd: false, passkeys: [laptop] })

    expect(view.queryByRole('button', { name: 'Add a passkey' })).toBeNull()
    expect(view.getByText("This device can't use passkeys here. You can add one on the web app.")).toBeOnTheScreen()
    expect(view.getByRole('button', { name: 'Delete Laptop' })).toBeOnTheScreen()
  })

  it('deletes a passkey only after the person confirms', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined)
    const onDelete = jest.fn()
    const { view } = await renderSection({ onDelete, passkeys: [laptop] })

    await fireEvent.press(view.getByRole('button', { name: 'Delete Laptop' }))

    expect(onDelete).not.toHaveBeenCalled()
    const [title, message, buttons] = alert.mock.calls[0] ?? []
    expect(title).toBe('Delete this passkey?')
    expect(message).toContain("You won't be able to sign in with Laptop any more.")
    const confirm = buttons?.find((button) => button.style === 'destructive')
    expect(confirm?.text).toBe('Delete passkey')
    confirm?.onPress?.()
    expect(onDelete).toHaveBeenCalledWith('pk-1')
  })

  it('shows loading, and a retry when the list could not be loaded', async () => {
    const loading = await renderSection({ status: 'loading' })
    expect(loading.view.getByRole('progressbar')).toBeOnTheScreen()
    await loading.view.unmount()

    const onRetry = jest.fn()
    const { view } = await renderSection({ status: 'error', onRetry })
    expect(view.getByRole('alert')).toHaveTextContent("Your passkeys couldn't be loaded. Try again later.")
    await fireEvent.press(view.getByRole('button', { name: 'Retry' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('reports the last action', async () => {
    const added = await renderSection({ notice: 'added' })
    expect(added.view.getByText('Passkey added.')).toBeOnTheScreen()
    await added.view.unmount()

    const stale = await renderSection({ notice: 'session-not-fresh' })
    expect(stale.view.getByRole('alert')).toHaveTextContent('Sign out and sign in again before adding a passkey.')
  })
})
