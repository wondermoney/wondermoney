import { instanceName } from '@config/instance-name';
import { ENABLE_BANKING_PROVIDER_ID, isBankProviderEnabled } from '@service/bank-providers/registry';
import { ENABLE_BANKING_CALLBACK_URL } from '@utils/constants';

/** WonderMoney's own policies, which a person registering an application for personal use can point at. */
const DEFAULT_PRIVACY_URL = 'https://docs.wonder.money/about/privacy-policy';
const DEFAULT_TERMS_URL = 'https://docs.wonder.money/about/terms-of-service';

/**
 * What a person enters in Enable Banking's Control Panel to register their own application for
 * this server, for `GET /v1/instance`. `redirectUrl` is this API's callback, so a self-hosted server
 * shows its own address. The privacy URL is the operator's `PRIVACY_POLICY_URL` when set (its
 * `{lang}` read as English), else WonderMoney's. A Production application needs both URLs, and its
 * description is shown to the person at their bank's consent. Null when Enable Banking is off.
 */
export interface EnableBankingApplicationSetup {
  applicationDescription: string;
  applicationName: string;
  privacyUrl: string;
  redirectUrl: string;
  termsUrl: string;
}

export function enableBankingApplicationSetup(env: Readonly<Record<string, string | undefined>> = process.env): EnableBankingApplicationSetup | null {
  if (!isBankProviderEnabled(ENABLE_BANKING_PROVIDER_ID)) return null;
  const name = instanceName(env);
  return {
    applicationDescription: `Personal use: reads my own bank accounts into ${name}.`,
    applicationName: name,
    privacyUrl: env['PRIVACY_POLICY_URL']?.trim().replaceAll('{lang}', 'en') || DEFAULT_PRIVACY_URL,
    redirectUrl: ENABLE_BANKING_CALLBACK_URL,
    termsUrl: DEFAULT_TERMS_URL,
  };
}
