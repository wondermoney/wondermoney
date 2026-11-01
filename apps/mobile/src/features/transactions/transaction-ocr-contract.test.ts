import {
  buildTransactionOcrFormData,
  createConfirmTransactionOcrEndpoint,
  createRejectTransactionOcrEndpoint,
  freezeConfirmTransactionOcr,
  transactionOcrScanEndpoint,
} from './transaction-ocr-contract'

describe('transactionOcrScanEndpoint', () => {
  it('posts to the shared OCR upload path', () => {
    expect(transactionOcrScanEndpoint.method).toBe('POST')
    expect(transactionOcrScanEndpoint.path).toBe('/v1/account/transaction/ocr')
  })

  it('accepts a scan response with only the required fields present', () => {
    const result = transactionOcrScanEndpoint.schema.safeParse({
      transactionOcrImportId: 5,
      transactionInfo: { settlementAmount: 12.5, transactionDate: '2026-07-18T10:00:00.000Z', transactionMerchantName: 'Corner shop' },
    })
    expect(result.success).toBe(true)
  })

  it('strips fields the API adds to a scan response', () => {
    const scan = { transactionOcrImportId: 5, transactionInfo: { settlementAmount: 12.5, transactionDate: '2026-07-18T10:00:00.000Z', transactionMerchantName: 'Corner shop' } }
    expect(transactionOcrScanEndpoint.schema.parse({ ...scan, model: 'x', transactionInfo: { ...scan.transactionInfo, confidence: 0.9 } })).toEqual(scan)
  })

  it('accepts a scan response with matched currency and merchant ids', () => {
    const result = transactionOcrScanEndpoint.schema.safeParse({
      transactionOcrImportId: 5,
      transactionInfo: { settlementAmount: 12.5, settlementCurrencyId: 2, transactionDate: '2026-07-18T10:00:00.000Z', transactionMerchantId: 9, transactionMerchantName: 'Corner shop' },
    })
    expect(result.success).toBe(true)
  })

  it('rejects a response missing a required field', () => {
    const result = transactionOcrScanEndpoint.schema.safeParse({
      transactionOcrImportId: 5,
      transactionInfo: { transactionDate: '2026-07-18T10:00:00.000Z', transactionMerchantName: 'Corner shop' },
    })
    expect(result.success).toBe(false)
  })
})

describe('buildTransactionOcrFormData', () => {
  it('appends exactly one "file" part matching multer\'s upload.single("file")', () => {
    const formData = buildTransactionOcrFormData({ uri: 'file:///receipt.jpg', name: 'receipt.jpg', mimeType: 'image/jpeg' })
    expect(formData.getAll('file')).toHaveLength(1)
  })
})

describe('freezeConfirmTransactionOcr', () => {
  const now = new Date('2026-07-20T00:00:00.000Z')
  const baseDraft = {
    transactionOcrImportId: 5,
    accountId: 7,
    transactionTypeId: 3,
    transactionDate: '2026-07-18',
    settlementAmount: '12.50',
    settlementCurrencyId: 2,
    newMerchantName: 'Corner shop',
  }

  it('resolves an existing-merchant draft into the confirm body', () => {
    const frozen = freezeConfirmTransactionOcr({ ...baseDraft, newMerchantName: undefined, existingMerchantId: 9 }, now)
    expect(frozen).toEqual({
      transactionOcrImportId: 5,
      payload: {
        accountId: 7,
        transactionTypeId: 3,
        transactionDate: '2026-07-18T12:00:00.000Z',
        settlementAmount: '12.50',
        settlementCurrencyId: 2,
        transactionMerchantId: 9,
      },
    })
  })

  it('resolves a new-merchant-name draft into the confirm body', () => {
    const frozen = freezeConfirmTransactionOcr(baseDraft, now)
    expect(frozen.payload).toMatchObject({ transactionMerchantName: 'Corner shop' })
    expect(frozen.payload).not.toHaveProperty('transactionMerchantId')
  })

  it('includes an optional category and description only when provided', () => {
    const frozen = freezeConfirmTransactionOcr({ ...baseDraft, categoryId: 4, description: '  Lunch  ' }, now)
    expect(frozen.payload).toMatchObject({ categoryIds: [4], description: 'Lunch' })
  })

  it('rejects a draft with neither an existing merchant id nor a new merchant name', () => {
    expect(() => freezeConfirmTransactionOcr({ ...baseDraft, newMerchantName: undefined }, now)).toThrow('Choose an existing merchant')
  })

  it('rejects a future transaction date', () => {
    expect(() => freezeConfirmTransactionOcr({ ...baseDraft, transactionDate: '2026-07-21' }, now)).toThrow('nonfuture')
  })

  it('rejects a non-positive amount', () => {
    expect(() => freezeConfirmTransactionOcr({ ...baseDraft, settlementAmount: '0' }, now)).toThrow()
    expect(() => freezeConfirmTransactionOcr({ ...baseDraft, settlementAmount: '-5' }, now)).toThrow()
  })

  it('rejects a description longer than 500 characters', () => {
    expect(() => freezeConfirmTransactionOcr({ ...baseDraft, description: 'x'.repeat(501) }, now)).toThrow()
  })

  it('returns a frozen payload', () => {
    const frozen = freezeConfirmTransactionOcr(baseDraft, now)
    expect(Object.isFrozen(frozen)).toBe(true)
    expect(Object.isFrozen(frozen.payload)).toBe(true)
  })
})

describe('createConfirmTransactionOcrEndpoint', () => {
  it('builds the confirm PUT path and accepts the 201 the controller sends', () => {
    const endpoint = createConfirmTransactionOcrEndpoint(5)
    expect(endpoint.method).toBe('PUT')
    expect(endpoint.path).toBe('/v1/account/transaction/ocr/5/confirm')
    expect(endpoint.successStatuses).toEqual([201])
  })

  it('rejects a non-positive id', () => {
    expect(() => createConfirmTransactionOcrEndpoint(0)).toThrow()
  })
})

describe('createRejectTransactionOcrEndpoint', () => {
  it('builds the reject PUT path', () => {
    const endpoint = createRejectTransactionOcrEndpoint(5)
    expect(endpoint.method).toBe('PUT')
    expect(endpoint.path).toBe('/v1/account/transaction/ocr/5/reject')
  })
})
