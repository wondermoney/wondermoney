import {
  createTransactionTemplateEndpoint,
  deleteTransactionTemplateEndpoint,
  freezeTemplateInput,
  transactionTemplateSchema,
  transactionTemplatesEndpoint,
  updateTransactionTemplateEndpoint,
} from './templates-contract'

const template = {
  transactionTemplateKey: 4,
  name: 'Weekly groceries',
  direction: 'out',
  amount: 42.5,
  description: 'Saturday market',
  notes: 'Cash',
  position: 0,
  account: { accountKey: 7, accountName: 'Wallet' },
  category: { categoryKey: 9, name: 'Groceries' },
  transactionMerchant: { transactionMerchantKey: 12, name: 'Corner shop' },
}

describe('transaction template contract', () => {
  it('reads the API shape and tolerates what a template does not carry', () => {
    expect(transactionTemplateSchema.parse(template)).toEqual(template)
    expect(transactionTemplateSchema.parse({
      ...template,
      account: null,
      amount: null,
      category: null,
      description: null,
      notes: null,
      transactionMerchant: null,
    })).toMatchObject({ account: null, amount: null, category: null })
  })

  it('rejects a template without a name or with an unknown direction', () => {
    expect(transactionTemplateSchema.safeParse({ ...template, name: '' }).success).toBe(false)
    expect(transactionTemplateSchema.safeParse({ ...template, direction: 'sideways' }).success).toBe(false)
  })

  it('points at the template endpoints', () => {
    expect(transactionTemplatesEndpoint).toMatchObject({ method: 'GET', path: '/v1/transaction-template' })
    expect(createTransactionTemplateEndpoint).toMatchObject({ method: 'POST', path: '/v1/transaction-template', successStatuses: [201] })
    expect(updateTransactionTemplateEndpoint(4)).toMatchObject({ method: 'PATCH', path: '/v1/transaction-template/4' })
    expect(deleteTransactionTemplateEndpoint(4)).toMatchObject({ method: 'DELETE', path: '/v1/transaction-template/4', successStatuses: [204] })
  })

  it('trims the name and text, and keeps a positive amount only', () => {
    expect(freezeTemplateInput({
      name: '  Bus ticket ',
      direction: 'in',
      amount: 2.5,
      description: '  ',
      notes: ' Monthly ',
    })).toEqual({
      name: 'Bus ticket',
      direction: 'in',
      amount: 2.5,
      description: null,
      notes: 'Monthly',
    })
    expect(() => freezeTemplateInput({ name: 'Zero', direction: 'out', amount: 0 })).toThrow()
  })
})
