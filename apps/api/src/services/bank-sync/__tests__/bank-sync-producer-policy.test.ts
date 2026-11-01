import { describe, expect, it } from 'vitest';

import { bankRecoveryTreatmentMode } from '@service/bank-sync/bank-sync-producer-policy';

const ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

describe('bank recovery producer policy', () => {
  // Bank recovery has no rollout gate: it is live for every incident owner, so a
  // failure always snapshots the 'live' treatment mode whatever the env says.
  it('snapshots live for every owner, regardless of env or the retired rollout flag', () => {
    expect(bankRecoveryTreatmentMode(ID, { APP_ENV: 'production', BANK_RECOVERY_MODE: 'live' })).toBe('live');
    expect(bankRecoveryTreatmentMode(ID, { APP_ENV: 'staging', BANK_RECOVERY_MODE: 'live' })).toBe('live');
    expect(bankRecoveryTreatmentMode(ID, { NODE_ENV: 'development' })).toBe('live');
    expect(bankRecoveryTreatmentMode(ID, { BANK_RECOVERY_MODE: 'off' })).toBe('live');
    expect(bankRecoveryTreatmentMode(ID, {})).toBe('live');
  });
});
