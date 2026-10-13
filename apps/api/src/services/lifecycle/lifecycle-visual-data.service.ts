import type { EntityManager } from '@mikro-orm/core';
import type { LifecycleDynamicData } from '@wondermoney/react-email';

import { Appuser } from '@entity/Appuser';
import { EnableBankingConnection, EnableBankingConnectionStatus } from '@entity/EnableBankingConnection';
import { getRef } from '@utils/em-helpers';

type Lang = 'EN' | 'PT';

const intlLocale = (language: Lang): string => (language === 'PT' ? 'pt-PT' : 'en-GB');
const dateFormatter = (language: Lang) => new Intl.DateTimeFormat(intlLocale(language), { day: 'numeric', month: 'long', timeZone: 'Europe/Lisbon' });

/** data_health.consent_expiring: the real bank name + real expiry date of the soonest-expiring linked connection. */
export async function buildConsentExpiringData(em: EntityManager, appuser: Appuser, language: Lang): Promise<LifecycleDynamicData | undefined> {
  const connection = await em.findOne(
    EnableBankingConnection,
    { accessValidUntil: { $ne: null }, appuserKey: getRef(em, Appuser, appuser.appuserKey), deletedAt: null, status: EnableBankingConnectionStatus.LINKED },
    { orderBy: { accessValidUntil: 'ASC' } },
  );
  if (!connection?.accessValidUntil) return undefined;

  return {
    bankName: connection.aspspName || undefined,
    expiryDate: dateFormatter(language).format(connection.accessValidUntil),
  };
}
