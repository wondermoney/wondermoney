import type { EntityManager } from '@mikro-orm/postgresql';

import type { BankConnection } from '@entity/BankConnection';
import { instanceEnableBankingCredential } from '@service/enable-banking/instance-credential';
import { mayUseInstanceEnableBankingCredential } from '@service/enable-banking/instance-credential-policy';

import { enableBankingProvider } from './enable-banking.provider';
import type { BankConnectionRef, BankProvider, BankProviderId } from './types';

/**
 * The provider registry. A provider is available when it is compiled in *and* enabled by the
 * operator: `BANK_PROVIDERS` is a comma-separated list of ids (default: every compiled-in
 * provider). `GET /v1/instance` reports the enabled list, so clients hide what this server
 * cannot do.
 *
 * Adding an aggregator: implement `BankProvider`, add it to `PROVIDERS`, document its env in
 * the contributor guide under `apps/docs/content/docs/<locale>/self-hosting/adding-a-bank-provider`.
 */
const PROVIDERS: Record<BankProviderId, BankProvider> = {
  enable_banking: enableBankingProvider,
};

export const ENABLE_BANKING_PROVIDER_ID = 'enable_banking';

/** The providers this build can run, before the operator's `BANK_PROVIDERS` filter. */
export function compiledBankProviderIds(): BankProviderId[] {
  return Object.keys(PROVIDERS);
}

/**
 * The providers enabled on this instance. Unset `BANK_PROVIDERS` enables every compiled-in
 * provider; an explicit list is intersected with what this build actually has, so a typo or a
 * provider from a different build never yields a half-working feature.
 */
export function enabledBankProviderIds(): BankProviderId[] {
  const raw = process.env['BANK_PROVIDERS'];
  if (raw === undefined) return compiledBankProviderIds();
  const requested = raw.split(',').map((id) => id.trim()).filter(Boolean);
  return requested.filter((id) => PROVIDERS[id] !== undefined);
}

/**
 * A compiled-in provider whether or not the operator enabled it. For reading what is already
 * stored (instance-wide reporting), never for reaching a bank.
 */
export function compiledBankProvider(id: BankProviderId): BankProvider | undefined {
  return Object.hasOwn(PROVIDERS, id) ? PROVIDERS[id] : undefined;
}

export function getBankProvider(id: BankProviderId): BankProvider | undefined {
  return isBankProviderEnabled(id) ? PROVIDERS[id] : undefined;
}

export function isBankProviderEnabled(id: BankProviderId): boolean {
  return enabledBankProviderIds().includes(id);
}

export function requireBankProvider(id: BankProviderId): BankProvider {
  const provider = getBankProvider(id);
  if (!provider) throw new Error(`Bank provider "${id}" is not enabled on this instance`);
  return provider;
}

/**
 * Where new bank links get their Enable Banking credential: `instance` when the operator set the
 * instance-wide one (`ENABLE_BANKING_APP_ID`), `user` when each user brings their own.
 */
export type BankSyncCredentials = 'instance' | 'user';

/**
 * What `GET /v1/instance` reports about bank sync. `bankSyncCredentials` is the instance's
 * capability; whether a given household may use the shared credential is
 * {@link bankSyncCredentialsFor}, on the signed-in profile.
 */
export function bankSyncFeatures(): { bankSync: boolean; bankSyncCredentials: BankSyncCredentials; bankSyncProviders: BankProviderId[] } {
  const bankSyncProviders = enabledBankProviderIds();
  const instanceCredential = bankSyncProviders.includes(ENABLE_BANKING_PROVIDER_ID) && instanceEnableBankingCredential() !== null;
  return { bankSync: bankSyncProviders.length > 0, bankSyncCredentials: instanceCredential ? 'instance' : 'user', bankSyncProviders };
}

/** The per-caller answer: `instance` when this household's new links may use the shared credential. */
export async function bankSyncCredentialsFor(em: EntityManager, tenantKey: number): Promise<BankSyncCredentials> {
  if (!isBankProviderEnabled(ENABLE_BANKING_PROVIDER_ID)) return 'user';
  return (await mayUseInstanceEnableBankingCredential(em, tenantKey)) ? 'instance' : 'user';
}

/** Reduce a `BankConnection` row to the provider-facing reference. */
export function bankConnectionRef(connection: BankConnection): BankConnectionRef {
  return {
    appuserId: primaryKeyOf(connection.appuserKey),
    bankConnectionKey: connection.bankConnectionKey,
    externalId: connection.externalId ?? connection.state ?? String(connection.bankConnectionKey),
    provider: connection.provider,
    status: connection.status,
    tenantId: connection.tenantKey ? primaryKeyOf(connection.tenantKey) : undefined,
  };
}

function primaryKeyOf(value: unknown): number {
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of ['appuserKey', 'tenantKey', 'bankConnectionKey']) {
      if (typeof record[key] === 'number') return record[key];
    }
  }
  return 0;
}
