import type { EntityManager } from '@mikro-orm/core';
import type { LifecycleDynamicData } from '@wondermoney/react-email';

import { Account } from '@entity/Account';
import { Appuser } from '@entity/Appuser';
import { NordigenRequisition, NordigenRequisitionStatus } from '@entity/NordigenRequisition';
import { getRef } from '@utils/em-helpers';

type Lang = 'EN' | 'PT';

const intlLocale = (language: Lang): string => (language === 'PT' ? 'pt-PT' : 'en-GB');
const dateFormatter = (language: Lang) => new Intl.DateTimeFormat(intlLocale(language), { day: 'numeric', month: 'long', timeZone: 'Europe/Lisbon' });

/** data_health.consent_expiring: the real bank name + real expiry date of the soonest-expiring linked connection. */
export async function buildConsentExpiringData(em: EntityManager, appuser: Appuser, language: Lang): Promise<LifecycleDynamicData | undefined> {
  const requisition = await em.findOne(
    NordigenRequisition,
    { appuserKey: getRef(em, Appuser, appuser.appuserKey), expiresAt: { $ne: null }, status: NordigenRequisitionStatus.LN },
    { orderBy: { expiresAt: 'ASC' } },
  );
  if (!requisition?.expiresAt) return undefined;

  const account = await em.findOne(
    Account,
    { deletedAt: null, nordigenRequisitionKey: getRef(em, NordigenRequisition, requisition.nordigenRequisitionKey) },
    { populate: ['accountFinancialInstitutionKey'] },
  );
  const institution = account?.accountFinancialInstitutionKey;

  return {
    bankName: institution?.displayName ?? institution?.name,
    expiryDate: dateFormatter(language).format(requisition.expiresAt),
  };
}
