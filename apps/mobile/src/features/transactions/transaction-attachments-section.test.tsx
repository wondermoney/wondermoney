import { fireEvent, render } from '@testing-library/react-native'
import * as WebBrowser from 'expo-web-browser'
import { I18nextProvider } from 'react-i18next'

import { initMobileI18n } from '@/lib/i18n'

import { TransactionAttachmentsSection } from './transaction-attachments-section'

const mockState = {
  attachments: [] as { transactionAttachmentKey: number; fileName: string; contentType: string; sizeBytes: number; createdAt: string; url: string }[],
  deleteAsync: jest.fn(),
  pickCamera: jest.fn(),
  pickFiles: jest.fn(),
  storage: true,
  uploadAsync: jest.fn(),
}

jest.mock('@/lib/server/use-instance', () => ({
  useConfirmedFeature: () => mockState.storage,
}))

jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn() }))

jest.mock('./attachment-picker', () => ({
  pickAttachmentFromCamera: () => mockState.pickCamera(),
  pickAttachmentsFromFiles: () => mockState.pickFiles(),
}))

jest.mock('./use-transaction-attachments', () => ({
  classifyAttachmentFailure: () => 'general',
  useDeleteTransactionAttachment: () => ({ mutateAsync: mockState.deleteAsync }),
  useTransactionAttachments: () => ({ data: { attachments: mockState.attachments } }),
  useUploadTransactionAttachment: () => ({ mutateAsync: mockState.uploadAsync }),
}))

async function renderSection() {
  const i18n = await initMobileI18n('en')
  return render(
    <I18nextProvider i18n={i18n}>
      <TransactionAttachmentsSection transactionId={7} />
    </I18nextProvider>,
  )
}

describe('TransactionAttachmentsSection', () => {
  beforeEach(() => {
    mockState.attachments = []
    mockState.deleteAsync.mockReset().mockResolvedValue(undefined)
    mockState.pickCamera.mockReset().mockResolvedValue(null)
    mockState.pickFiles.mockReset().mockResolvedValue([])
    mockState.storage = true
    mockState.uploadAsync.mockReset().mockResolvedValue({})
  })

  it('is hidden on a server without file storage', async () => {
    mockState.storage = false
    const view = await renderSection()
    expect(view.queryByText('Attachments')).toBeNull()
  })

  it('lists the files and opens one in the browser', async () => {
    mockState.attachments = [
      { transactionAttachmentKey: 1, fileName: 'invoice.pdf', contentType: 'application/pdf', sizeBytes: 2048, createdAt: '2026-07-20T10:00:00.000Z', url: 'https://storage.test/invoice.pdf' },
    ]
    const view = await renderSection()

    expect(view.getByText('Attachments')).toBeOnTheScreen()
    await fireEvent.press(view.getByLabelText('Open invoice.pdf'))

    expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith('https://storage.test/invoice.pdf')
  })

  it('deletes the file the person removes', async () => {
    mockState.attachments = [
      { transactionAttachmentKey: 41, fileName: 'receipt.png', contentType: 'image/png', sizeBytes: 1024, createdAt: '2026-07-20T10:00:00.000Z', url: 'https://storage.test/receipt.png' },
    ]
    const view = await renderSection()

    await fireEvent.press(view.getByLabelText('Delete receipt.png'))

    expect(mockState.deleteAsync).toHaveBeenCalledWith(41)
  })

  it('takes a photo and uploads it', async () => {
    mockState.pickCamera.mockResolvedValue({ uri: 'file:///tmp/photo.jpg', name: 'photo.jpg', mimeType: 'image/jpeg', sizeBytes: 1024 })
    const view = await renderSection()

    await fireEvent.press(view.getByRole('button', { name: 'Add photo' }))

    expect(mockState.pickCamera).toHaveBeenCalledTimes(1)
    expect(mockState.uploadAsync).toHaveBeenCalledWith({ uri: 'file:///tmp/photo.jpg', name: 'photo.jpg', mimeType: 'image/jpeg', sizeBytes: 1024 })
  })

  it('chooses files and uploads each one', async () => {
    mockState.pickFiles.mockResolvedValue([
      { uri: 'file:///tmp/a.pdf', name: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 2048 },
      { uri: 'file:///tmp/b.png', name: 'b.png', mimeType: 'image/png', sizeBytes: 1024 },
    ])
    const view = await renderSection()

    await fireEvent.press(view.getByRole('button', { name: 'Choose files' }))

    expect(mockState.uploadAsync).toHaveBeenCalledTimes(2)
  })
})
