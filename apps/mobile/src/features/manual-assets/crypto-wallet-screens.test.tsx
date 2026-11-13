import { fireEvent, render, waitFor, within } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'
import { Alert } from 'react-native'

import { initMobileI18n } from '@/lib/i18n'

import { AssetDetailScreen } from './asset-detail-screen'
import { AssetsScreen } from './assets-screen'
import { CryptoWalletCreateScreen } from './crypto-wallet-create-screen'
import type { CryptoWalletActions } from './crypto-wallet-section'
import { assetsFixture, BTC_ADDRESS, ETH_ADDRESS, HEX_PRIVATE_KEY, SEED_PHRASE, walletAssetFixture, walletDetailFixture } from './test-fixtures'

// The Skia canvas needs a native backend jest doesn't have.
jest.mock('victory-native', () => ({ CartesianChart: () => null, Area: () => null, Line: () => null }))

const renderScreen = async (node: React.ReactElement, language = 'en') => {
  const i18n = await initMobileI18n(language)
  return render(<I18nextProvider i18n={i18n}>{node}</I18nextProvider>)
}

describe('Assets list with crypto wallets', () => {
  it('offers Add crypto wallet only when the server reads a chain', async () => {
    const onCreateWallet = jest.fn()
    const on = await renderScreen(<AssetsScreen state={{ status: 'loaded', data: assetsFixture() }} onOpenAsset={jest.fn()} onCreateAsset={jest.fn()} onCreateWallet={onCreateWallet} onRefresh={jest.fn()} />)
    await fireEvent.press(on.getByRole('button', { name: 'Add crypto wallet' }))
    expect(onCreateWallet).toHaveBeenCalled()
    await on.unmount()
    const off = await renderScreen(<AssetsScreen state={{ status: 'loaded', data: assetsFixture() }} onOpenAsset={jest.fn()} onCreateAsset={jest.fn()} onRefresh={jest.fn()} />)
    expect(off.queryByRole('button', { name: 'Add crypto wallet' })).not.toBeOnTheScreen()
    await off.unmount()
    const empty = await renderScreen(<AssetsScreen state={{ status: 'loaded', data: assetsFixture([], { totalValue: 0 }) }} onOpenAsset={jest.fn()} onCreateAsset={jest.fn()} onRefresh={jest.fn()} />)
    expect(empty.queryByTestId('assets-add-wallet')).not.toBeOnTheScreen()
  })

  it('lists a wallet like any asset, with its crypto kind', async () => {
    const view = await renderScreen(<AssetsScreen state={{ status: 'loaded', data: assetsFixture([walletAssetFixture]) }} onOpenAsset={jest.fn()} onCreateAsset={jest.fn()} onRefresh={jest.fn()} />)
    expect(view.getByRole('button', { name: /^Cold storage, Crypto wallet, \$1,234\.50, USD/ })).toBeOnTheScreen()
    await view.unmount()
    const pending = await renderScreen(<AssetsScreen state={{ status: 'loaded', data: assetsFixture([{ ...walletAssetFixture, value: null, valueInUserCurrency: null, lastValuation: null }]) }} onOpenAsset={jest.fn()} onCreateAsset={jest.fn()} onRefresh={jest.fn()} />)
    expect(pending.getByRole('button', { name: 'Cold storage, Crypto wallet, Not valued yet' })).toBeOnTheScreen()
  })
})

describe('Add crypto wallet', () => {
  const screen = (onCreate = jest.fn().mockResolvedValue(null), chains: ('bitcoin' | 'ethereum')[] = ['bitcoin', 'ethereum']) => (
    <CryptoWalletCreateScreen chains={chains} pending={false} onBack={jest.fn()} onCreate={onCreate} />
  )

  it('says plainly that only public addresses are taken', async () => {
    const view = await renderScreen(screen())
    expect(within(view.getByTestId('wallet-public-only')).getByText(/Only public addresses are accepted.*Never enter a private key or a recovery phrase/)).toBeOnTheScreen()
  })

  it('sends the name, privacy and each address on its chain, as the contract has it', async () => {
    const onCreate = jest.fn().mockResolvedValue(null)
    const view = await renderScreen(screen(onCreate))
    expect(view.getByRole('button', { name: 'Add wallet' })).toBeDisabled()
    await fireEvent.changeText(view.getByLabelText('Name'), 'Cold storage')
    await fireEvent.press(view.getByRole('switch', { name: 'Private wallet' }))
    await fireEvent.changeText(view.getByLabelText('Address, address 1'), ` ${BTC_ADDRESS} `)
    await fireEvent.changeText(view.getByLabelText('Label, optional, address 1'), 'Hardware')
    await fireEvent.press(view.getByRole('button', { name: 'Add another address' }))
    await fireEvent.press(view.getByRole('button', { name: 'Network, address 2, Bitcoin' }))
    await fireEvent.press(view.getByRole('radio', { name: 'Ethereum' }))
    await fireEvent.changeText(view.getByLabelText('Address, address 2'), ETH_ADDRESS)
    await fireEvent.press(view.getByRole('button', { name: 'Add wallet' }))
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith({
      name: 'Cold storage',
      isPrivate: true,
      addresses: [{ chain: 'bitcoin', address: BTC_ADDRESS, label: 'Hardware' }, { chain: 'ethereum', address: ETH_ADDRESS }],
    }))
  })

  it('offers only the enabled chains', async () => {
    const view = await renderScreen(screen(jest.fn(), ['ethereum']))
    await fireEvent.press(view.getByRole('button', { name: 'Network, address 1, Ethereum' }))
    expect(view.queryByRole('radio', { name: 'Bitcoin' })).not.toBeOnTheScreen()
  })

  it.each([['a private key', HEX_PRIVATE_KEY], ['a recovery phrase', SEED_PHRASE]])('blocks %s on the device, clears it and never shows it', async (_label, secret) => {
    const onCreate = jest.fn().mockResolvedValue(null)
    const view = await renderScreen(screen(onCreate))
    await fireEvent.changeText(view.getByLabelText('Name'), 'Cold storage')
    await fireEvent.changeText(view.getByLabelText('Address, address 1'), secret)
    await fireEvent.press(view.getByRole('button', { name: 'Add wallet' }))
    expect(await view.findByText('That looked like a private key or a recovery phrase, so it was cleared and not sent. Enter a public address instead.')).toBeOnTheScreen()
    expect(onCreate).not.toHaveBeenCalled()
    expect(view.getByLabelText('Address, address 1').props.value).toBe('')
    expect(view.queryByText(new RegExp(secret.slice(0, 16)))).not.toBeOnTheScreen()
    expect(view.queryByDisplayValue(secret)).not.toBeOnTheScreen()
    expect(JSON.stringify(view.toJSON())).not.toContain(secret.slice(0, 16))
  })

  it('clears the address the API refused as a secret, and words the other refusals', async () => {
    const onCreate = jest.fn()
      .mockResolvedValueOnce({ kind: 'address-invalid', addressIndex: 0 })
      .mockResolvedValueOnce({ kind: 'secret-rejected', addressIndex: 0 })
      .mockResolvedValueOnce({ kind: 'feature-disabled', addressIndex: null })
    const view = await renderScreen(screen(onCreate))
    await fireEvent.changeText(view.getByLabelText('Name'), 'Cold storage')
    await fireEvent.changeText(view.getByLabelText('Address, address 1'), BTC_ADDRESS)
    await fireEvent.press(view.getByRole('button', { name: 'Add wallet' }))
    expect(await view.findByText('This is not a valid address for the chosen network.')).toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Add wallet' }))
    await waitFor(() => expect(view.getByLabelText('Address, address 1').props.value).toBe(''))
    await fireEvent.changeText(view.getByLabelText('Address, address 1'), BTC_ADDRESS)
    await fireEvent.press(view.getByRole('button', { name: 'Add wallet' }))
    expect(await view.findByText('Crypto wallets are not turned on for this network on this server.')).toBeOnTheScreen()
  })

  it('reads in Portuguese', async () => {
    const view = await renderScreen(screen(), 'pt-PT')
    expect(view.getByText(/Só são aceites endereços públicos/)).toBeOnTheScreen()
  })
})

describe('Crypto wallet page', () => {
  const actions = (overrides: Partial<CryptoWalletActions> = {}): CryptoWalletActions => ({
    chains: ['bitcoin', 'ethereum'],
    pending: false,
    onToggleToken: jest.fn().mockResolvedValue(null),
    onAddAddress: jest.fn().mockResolvedValue(null),
    onSetLabel: jest.fn().mockResolvedValue(null),
    onRemoveAddress: jest.fn().mockResolvedValue(null),
    onSyncNow: jest.fn().mockResolvedValue(null),
    onUpdateWallet: jest.fn().mockResolvedValue(null),
    onDeleteWallet: jest.fn().mockResolvedValue(null),
    ...overrides,
  })
  const detail = (wallet = actions(), data = walletDetailFixture(), onUpdateValue = jest.fn()) => (
    <AssetDetailScreen state={{ status: 'loaded', data }} onBack={jest.fn()} onUpdateValue={onUpdateValue} onRefresh={jest.fn()} wallet={wallet} />
  )

  it('has no Update value or valuations list: the sync values it', async () => {
    const view = await renderScreen(detail())
    expect(view.getByText('Value today')).toBeOnTheScreen()
    expect(view.queryByRole('button', { name: 'Update value' })).not.toBeOnTheScreen()
    expect(view.queryByTestId('asset-valuations')).not.toBeOnTheScreen()
    expect(view.getByText('Archive this wallet or edit its notes in WonderMoney on the web.')).toBeOnTheScreen()
  })

  it('shows each address with its chain, kind, label, short address and status', async () => {
    const view = await renderScreen(detail())
    const btc = view.getByTestId('wallet-address-31')
    expect(within(btc).getByLabelText(/^Hardware, Bitcoin, Address, bc1qar0s…5mdq, Synced, Synced /)).toBeOnTheScreen()
    const eth = view.getByTestId('wallet-address-32')
    expect(within(eth).getByLabelText(/^Ethereum, Address, 0x5aAeb6…eAed, Failed, The explorer took too long to answer\. Balances as of /)).toBeOnTheScreen()
    // Tokens with their exact quantities.
    expect(within(btc).getByText('0.01234567 BTC')).toBeOnTheScreen()
    expect(within(eth).getByText('1,250.5 ETH')).toBeOnTheScreen()
  })

  it('marks a ticked token with no price, says the value held, and that detected tokens wait to be ticked', async () => {
    const view = await renderScreen(detail())
    expect(within(view.getByTestId('wallet-address-32')).getByText('No price')).toBeOnTheScreen()
    expect(view.getByTestId('wallet-unpriced')).toHaveTextContent("No price for WMT, so today's value was not updated. Untick a token to leave it out.")
    expect(view.getByText(/Tokens found on an address are ignored until you tick them/)).toBeOnTheScreen()
    await view.unmount()
    const priced = await renderScreen(detail(actions(), walletDetailFixture({ unpricedSymbols: [] })))
    expect(priced.queryByTestId('wallet-unpriced')).not.toBeOnTheScreen()
  })

  it('ticks and unticks a token', async () => {
    const wallet = actions()
    const view = await renderScreen(detail(wallet))
    const xyz = view.getByRole('switch', { name: 'Count XYZ' })
    expect(xyz.props.value).toBe(false)
    await fireEvent(xyz, 'valueChange', true)
    expect(wallet.onToggleToken).toHaveBeenCalledWith(44, true)
    await fireEvent(view.getByRole('switch', { name: 'Count ETH' }), 'valueChange', false)
    expect(wallet.onToggleToken).toHaveBeenCalledWith(42, false)
  })

  it('asks for a sync and says it is on its way', async () => {
    const wallet = actions()
    const view = await renderScreen(detail(wallet))
    await fireEvent.press(view.getByRole('button', { name: 'Sync now' }))
    expect(wallet.onSyncNow).toHaveBeenCalled()
    expect(await view.findByText(/Sync requested/)).toBeOnTheScreen()
  })

  it('removes an address only once confirmed', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => buttons?.[1]?.onPress?.())
    const wallet = actions()
    const view = await renderScreen(detail(wallet))
    await fireEvent.press(view.getByRole('button', { name: 'Remove Hardware' }))
    await waitFor(() => expect(wallet.onRemoveAddress).toHaveBeenCalledWith(31))
    expect(alert).toHaveBeenCalledWith('Remove this address?', 'Hardware and its tokens stop counting towards this wallet.', expect.anything(), expect.anything())
    alert.mockImplementation((_title, _message, buttons) => buttons?.[0]?.onPress?.())
    await fireEvent.press(view.getByRole('button', { name: 'Remove 0x5aAeb6…eAed' }))
    expect(wallet.onRemoveAddress).toHaveBeenCalledTimes(1)
    alert.mockRestore()
  })

  it('adds an address with the same guard: a secret is cleared and never sent', async () => {
    const wallet = actions()
    const view = await renderScreen(detail(wallet))
    await fireEvent.press(view.getByRole('button', { name: 'Add address' }))
    const sheet = within(view.getByTestId('wallet-add-address'))
    await fireEvent.changeText(sheet.getByLabelText('Address'), SEED_PHRASE)
    await fireEvent.press(sheet.getByRole('button', { name: 'Add address' }))
    expect(await sheet.findByText(/so it was cleared and not sent/)).toBeOnTheScreen()
    expect(sheet.getByLabelText('Address').props.value).toBe('')
    expect(wallet.onAddAddress).not.toHaveBeenCalled()
    await fireEvent.changeText(sheet.getByLabelText('Address'), BTC_ADDRESS)
    await fireEvent.press(sheet.getByRole('button', { name: 'Add address' }))
    await waitFor(() => expect(wallet.onAddAddress).toHaveBeenCalledWith({ chain: 'bitcoin', address: BTC_ADDRESS }))
  })

  it('edits an address label', async () => {
    const wallet = actions()
    const view = await renderScreen(detail(wallet))
    await fireEvent.press(view.getByRole('button', { name: 'Edit label of Hardware' }))
    await fireEvent.changeText(view.getByLabelText('Label, optional'), 'Ledger')
    await fireEvent.press(view.getByRole('button', { name: 'Save label' }))
    await waitFor(() => expect(wallet.onSetLabel).toHaveBeenCalledWith(31, 'Ledger'))
  })

  it('shows a pending address and a wallet not valued yet', async () => {
    const pending = { ...walletDetailFixture().wallet!.addresses[0], status: 'pending' as const, lastSyncedAt: null, tokens: [] }
    const view = await renderScreen(detail(actions(), walletDetailFixture({ addresses: [pending], lastSyncedAt: null, unpricedSymbols: [] }, { value: null, valueInUserCurrency: null, lastValuation: null })))
    expect(view.getByLabelText(/^Hardware, Bitcoin, Address, bc1qar0s…5mdq, Pending, Waiting for the first read$/)).toBeOnTheScreen()
    expect(view.getByText('Not valued yet: the value appears after the first sync.')).toBeOnTheScreen()
    // The last address is not removed here: the wallet itself is deleted on the web.
    expect(view.queryByRole('button', { name: 'Remove Hardware' })).not.toBeOnTheScreen()
  })

  it('renames the wallet and, for its owner, makes it private', async () => {
    const wallet = actions()
    const view = await renderScreen(detail(wallet))
    await fireEvent.press(view.getByRole('button', { name: 'Edit wallet' }))
    const sheet = within(view.getByTestId('wallet-edit'))
    expect(sheet.getByRole('button', { name: 'Save' })).toBeDisabled()
    await fireEvent.changeText(sheet.getByLabelText('Name'), ' Ledger ')
    await fireEvent.press(sheet.getByRole('switch', { name: 'Private wallet' }))
    await fireEvent.press(sheet.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(wallet.onUpdateWallet).toHaveBeenCalledWith({ name: 'Ledger', isPrivate: true }))
  })

  it('lets a household member who does not own the wallet rename it, but not change its privacy', async () => {
    const wallet = actions()
    const view = await renderScreen(detail(wallet, walletDetailFixture({}, { isOwner: false, ownerFirstName: 'Rui' })))
    await fireEvent.press(view.getByRole('button', { name: 'Edit wallet' }))
    const sheet = within(view.getByTestId('wallet-edit'))
    expect(sheet.queryByRole('switch', { name: 'Private wallet' })).not.toBeOnTheScreen()
    await fireEvent.changeText(sheet.getByLabelText('Name'), 'Shared cold storage')
    await fireEvent.press(sheet.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(wallet.onUpdateWallet).toHaveBeenCalledWith({ name: 'Shared cold storage' }))
  })

  it('removes the wallet only once confirmed', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => buttons?.[0]?.onPress?.())
    const wallet = actions()
    const view = await renderScreen(detail(wallet))
    await fireEvent.press(view.getByRole('button', { name: 'Remove wallet' }))
    await waitFor(() => expect(alert).toHaveBeenCalledWith('Remove this wallet?', 'Cold storage, its addresses and its value history are deleted. This cannot be undone.', expect.anything(), expect.anything()))
    expect(wallet.onDeleteWallet).not.toHaveBeenCalled()
    alert.mockImplementation((_title, _message, buttons) => buttons?.[1]?.onPress?.())
    await fireEvent.press(view.getByRole('button', { name: 'Remove wallet' }))
    await waitFor(() => expect(wallet.onDeleteWallet).toHaveBeenCalledTimes(1))
    alert.mockRestore()
  })

  it('offers no edit or removal on an archived wallet', async () => {
    const view = await renderScreen(detail(actions(), walletDetailFixture({}, { archived: true, archivedAt: '2026-11-12T09:00:00.000Z', value: null, valueInUserCurrency: null })))
    expect(view.queryByRole('button', { name: 'Edit wallet' })).not.toBeOnTheScreen()
    expect(view.queryByRole('button', { name: 'Remove wallet' })).not.toBeOnTheScreen()
  })
})
