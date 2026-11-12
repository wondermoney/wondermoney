import type { FilterQuery } from '@mikro-orm/core';
import type { Request, Response } from 'express';

import { TransactionMerchant } from '@entity/TransactionMerchant';
import { authedContext } from '@middleware/authed-context';
import { fetchMerchantLogo, merchantLogoTemplate, toMerchantDto, websiteDomain } from '@service/transaction/merchant-logo';
import { findMerchantsSeenOnlyOnOthersPrivateAccounts } from '@service/transaction/merchant-visibility';
import { NotFoundError } from '@utils/errors';
import { getTransactionMerchantLogoRequestSchema, updateTransactionMerchantRequestSchema } from '@validators/merchant';
import { zParse } from '@validators/parser';

import { DI } from '../../app.js';

/**
 * A merchant the viewer may see: the household's own or a global one (`own: false`), never one
 * known only from the other member's private account. `own: true` is for edits: a global merchant
 * is shared by every household, so none of them may change it.
 */
async function findVisibleMerchant(req: Request, merchantKey: number, options: { own: boolean }): Promise<TransactionMerchant> {
  const { appuserKey, tenant, tenantKey } = authedContext(req);
  const where: FilterQuery<TransactionMerchant> = options.own
    ? { deletedAt: undefined, tenantKey: tenant, transactionMerchantKey: merchantKey }
    : { $or: [{ tenantKey: tenant }, { tenantKey: null }], deletedAt: undefined, transactionMerchantKey: merchantKey };
  const merchant = await DI.em.findOne(TransactionMerchant, where);
  if (!merchant) throw new NotFoundError('TransactionMerchant not found');
  const hidden = await findMerchantsSeenOnlyOnOthersPrivateAccounts(tenantKey, appuserKey, merchantKey);
  if (hidden.length > 0) throw new NotFoundError('TransactionMerchant not found');
  return merchant;
}

/** `PATCH /v1/account/transaction-merchants/:merchantId`: set or clear the website and logo URL. */
export async function updateTransactionMerchant(req: Request, res: Response) {
  const {
    body: { logoUrl, website },
    params: { merchantId },
  } = await zParse(updateTransactionMerchantRequestSchema, req);
  const merchant = await findVisibleMerchant(req, merchantId, { own: true });
  if (website !== undefined) merchant.website = website;
  if (logoUrl !== undefined) merchant.logoUrl = logoUrl;
  await DI.em.persist(merchant).flush();
  return res.json({ transactionMerchant: toMerchantDto(merchant) });
}

/**
 * `GET /v1/account/transaction-merchants/:merchantId/logo`: the logo the instance's
 * `MERCHANT_LOGO_URL_TEMPLATE` finds for the merchant's website, fetched by the server so the
 * provider never sees the viewer (`services/transaction/merchant-logo.ts`). 404 when the template
 * is unset (and then nothing is fetched), the merchant has no website, the household set its own
 * logo URL (clients load that one directly) or the provider has no image.
 */
export async function getTransactionMerchantLogo(req: Request, res: Response) {
  const {
    params: { merchantId },
  } = await zParse(getTransactionMerchantLogoRequestSchema, req);
  const template = merchantLogoTemplate();
  if (!template) throw new NotFoundError('Merchant logos are not configured');
  const merchant = await findVisibleMerchant(req, merchantId, { own: false });
  const domain = merchant.logoUrl ? null : websiteDomain(merchant.website);
  if (!domain) throw new NotFoundError('Merchant has no logo');
  const logo = await fetchMerchantLogo(domain, template);
  if (!logo) throw new NotFoundError('Merchant has no logo');
  res.set({
    'Cache-Control': 'private, max-age=86400',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'Content-Type': logo.contentType,
    'X-Content-Type-Options': 'nosniff',
  });
  return res.send(logo.body);
}
