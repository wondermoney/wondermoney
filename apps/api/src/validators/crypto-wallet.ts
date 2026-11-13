import { z } from 'zod';

import { CRYPTO_CHAINS } from '@config/crypto-explorers';
import { MAX_WALLET_ADDRESSES } from '@service/crypto-wallet/crypto-wallet.service';
import { positiveIntId } from '@validators/shared';

/*
 * Crypto wallet requests. The address itself is only bounded here: `services/crypto-wallet/address.ts`
 * tells a public address from a secret, and none of these messages may quote it.
 */
const booleanLike = z.union([z.boolean(), z.enum(['true', 'false'])]).transform((value) => value === true || value === 'true');
const label = z.string().trim().max(100).nullish();

const addressInput = z.object({
  // A recovery phrase is a few hundred characters; anything longer is not an address either.
  address: z.string().min(1, 'Address is required').max(1000, 'Address is too long'),
  chain: z.enum(CRYPTO_CHAINS),
  label,
}).strict();

const walletParams = z.object({ manualAssetId: positiveIntId });

export const createCryptoWalletSchema = z.object({
  body: z.object({
    addresses: z.array(addressInput).min(1, 'Add at least one address').max(MAX_WALLET_ADDRESSES),
    isPrivate: booleanLike.optional(),
    name: z.string().trim().min(1, 'Name is required').max(255),
    notes: z.string().max(10_000).nullish(),
  }).strict(),
});

export const addWalletAddressSchema = z.object({ body: addressInput, params: walletParams });

export const updateWalletAddressSchema = z.object({
  body: z.object({ label: z.string().trim().max(100).nullable() }).strict(),
  params: walletParams.extend({ addressId: positiveIntId }),
});

export const walletAddressParamsSchema = z.object({ params: walletParams.extend({ addressId: positiveIntId }) });

export const updateWalletTokenSchema = z.object({
  body: z.object({ tracked: z.boolean() }).strict(),
  params: walletParams.extend({ tokenId: positiveIntId }),
});

export const walletParamsSchema = z.object({ params: walletParams });
