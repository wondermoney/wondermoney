import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react-native'
import type { ReactNode } from 'react'

import { AttachmentValidationError, useUploadTransactionAttachment } from './use-transaction-attachments'
import { TRANSACTION_ATTACHMENT_MAX_SIZE_BYTES } from './transaction-attachments-contract'

const mockWrite = jest.fn()
const mockUpload = jest.fn()

jest.mock('@/components/providers/product-runtime-provider', () => ({
  useProductRuntime: () => ({ runtime: { epochId: 12, apiClient: { write: mockWrite } } }),
}))

jest.mock('expo-file-system', () => ({
  File: class {
    upload = mockUpload
  },
  UploadType: { BINARY_CONTENT: 'binary' },
}))

function wrapperFor(client: QueryClient) {
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
  Wrapper.displayName = 'QueryClientWrapper'
  return Wrapper
}

describe('useUploadTransactionAttachment', () => {
  beforeEach(() => {
    mockWrite.mockReset()
    mockUpload.mockReset()
  })

  it('uploads straight to the store, then confirms the attachment', async () => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: 0 } } })
    const invalidate = jest.spyOn(client, 'invalidateQueries')
    mockWrite
      .mockResolvedValueOnce({ expiresInSeconds: 900, key: 'wmattachments/1/abc/receipt.png', presignedUrl: 'https://storage.test/put/receipt.png', uploadHeaders: { 'Content-Type': 'image/png' }, uploadMethod: 'PUT' })
      .mockImplementationOnce(async (_endpoint, options) => {
        options.commit(undefined)
        return { transactionAttachmentKey: 5 }
      })
    mockUpload.mockResolvedValue({ status: 200 })

    const hook = await renderHook(() => useUploadTransactionAttachment(7, 0), { wrapper: wrapperFor(client) })
    await act(async () => {
      await hook.result.current.mutateAsync({ uri: 'file:///tmp/receipt.png', name: 'receipt.png', mimeType: 'image/png', sizeBytes: 2048 })
    })

    expect(mockWrite).toHaveBeenNthCalledWith(1, expect.objectContaining({ method: 'POST', path: '/v1/account/transaction/7/attachments/upload-url' }), expect.objectContaining({
      body: { contentType: 'image/png', fileName: 'receipt.png', sizeBytes: 2048 },
    }))
    expect(mockUpload).toHaveBeenCalledWith('https://storage.test/put/receipt.png', expect.objectContaining({
      headers: { 'Content-Type': 'image/png' },
      httpMethod: 'PUT',
    }))
    expect(mockWrite).toHaveBeenNthCalledWith(2, expect.objectContaining({ method: 'POST', path: '/v1/account/transaction/7/attachments' }), expect.objectContaining({
      body: { fileName: 'receipt.png', key: 'wmattachments/1/abc/receipt.png' },
    }))
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['transactions', 12, 'attachments', 7] })

    await hook.unmount()
    client.clear()
  })

  it('refuses an oversize file before any request', async () => {
    const client = new QueryClient()
    const hook = await renderHook(() => useUploadTransactionAttachment(7, 0), { wrapper: wrapperFor(client) })

    await act(async () => {
      await expect(hook.result.current.mutateAsync({
        uri: 'file:///tmp/huge.pdf',
        name: 'huge.pdf',
        mimeType: 'application/pdf',
        sizeBytes: TRANSACTION_ATTACHMENT_MAX_SIZE_BYTES + 1,
      })).rejects.toBeInstanceOf(AttachmentValidationError)
    })

    expect(mockWrite).not.toHaveBeenCalled()
    await hook.unmount()
    client.clear()
  })

  it('refuses an eleventh file before any request', async () => {
    const client = new QueryClient()
    const hook = await renderHook(() => useUploadTransactionAttachment(7, 10), { wrapper: wrapperFor(client) })

    await act(async () => {
      await expect(hook.result.current.mutateAsync({
        uri: 'file:///tmp/one-more.png',
        name: 'one-more.png',
        mimeType: 'image/png',
        sizeBytes: 10,
      })).rejects.toMatchObject({ reason: 'limit' })
    })

    expect(mockWrite).not.toHaveBeenCalled()
    await hook.unmount()
    client.clear()
  })
})
