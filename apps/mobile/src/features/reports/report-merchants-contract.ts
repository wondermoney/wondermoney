import { z } from 'zod'

import { readEndpoint } from '../../lib/api/runtime-schema'

export const transactionMerchantSchema = z.object({
  transactionMerchantKey: z.number().int().positive(),
  name: z.string(),
})

export const transactionMerchantsResponseSchema = z.object({
  transactionMerchants: z.array(transactionMerchantSchema),
})

export type TransactionMerchant = z.infer<typeof transactionMerchantSchema>

export const transactionMerchantsEndpoint = readEndpoint({
  method: 'GET',
  path: '/v1/account/transaction-merchants',
  schema: transactionMerchantsResponseSchema,
})
