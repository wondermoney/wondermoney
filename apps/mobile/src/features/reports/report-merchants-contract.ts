import { z } from 'zod'

import { merchantLogoFields } from '@/features/merchants/merchant-contract'

import { readEndpoint } from '../../lib/api/runtime-schema'

export const transactionMerchantSchema = z.object({
  transactionMerchantKey: z.number().int().positive(),
  name: z.string(),
  // Optional: a server from before merchant logos sends only the key and the name.
  ...merchantLogoFields,
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
