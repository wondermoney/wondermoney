import { attachmentFileName, confirmTransactionAttachmentEndpoint, createTransactionAttachmentUploadUrlEndpoint, deleteTransactionAttachmentEndpoint, transactionAttachmentsEndpoint } from './transaction-attachments-contract'

describe('transaction attachment contract', () => {
  it('reads a transaction\'s attachments', () => {
    expect(transactionAttachmentsEndpoint(7)).toMatchObject({
      method: 'GET',
      path: '/v1/account/transaction/7/attachments',
    })
  })

  it('asks for a presigned upload, confirms it, and deletes by id', () => {
    expect(createTransactionAttachmentUploadUrlEndpoint(7)).toMatchObject({
      method: 'POST',
      path: '/v1/account/transaction/7/attachments/upload-url',
    })
    expect(confirmTransactionAttachmentEndpoint(7)).toMatchObject({
      method: 'POST',
      path: '/v1/account/transaction/7/attachments',
      successStatuses: [201],
    })
    expect(deleteTransactionAttachmentEndpoint(7, 41)).toMatchObject({
      method: 'DELETE',
      path: '/v1/account/transaction/7/attachments/41',
      successStatuses: [204],
    })
  })

  it('gives a name without an extension one the server recognises', () => {
    expect(attachmentFileName('invoice', 'application/pdf')).toBe('invoice.pdf')
    expect(attachmentFileName('photo', 'image/heic')).toBe('photo.heic')
    expect(attachmentFileName('receipt.png', 'image/png')).toBe('receipt.png')
  })
})
