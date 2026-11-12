import { describe, expect, it } from 'vitest';

import { seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { AiUsageAllowance } from '@entity/AiUsageAllowance';

import { aiDailyLimit, spendAiAllowance } from '../ai-allowance.service';

const NOON = new Date('2026-11-03T12:00:00Z');
const NEXT_DAY = new Date('2026-11-04T00:00:01Z');

describe('aiDailyLimit', () => {
  it('is unlimited when unset or blank, so a self-hosted install is not capped', () => {
    expect(aiDailyLimit('assistant', {})).toBeNull();
    expect(aiDailyLimit('ocr', { AI_DAILY_LIMIT_OCR: ' ' })).toBeNull();
  });

  it('reads one limit per feature', () => {
    const env = { AI_DAILY_LIMIT_ASSISTANT: '40', AI_DAILY_LIMIT_CSV_MAPPING: '0', AI_DAILY_LIMIT_OCR: '10', AI_DAILY_LIMIT_STATEMENT_IMPORT: '3' };
    expect(aiDailyLimit('assistant', env)).toBe(40);
    expect(aiDailyLimit('statementImport', env)).toBe(3);
    expect(aiDailyLimit('ocr', env)).toBe(10);
    expect(aiDailyLimit('csvMapping', env)).toBe(0);
  });

  it('treats a value that is not a whole number as unlimited rather than locking everyone out', () => {
    expect(aiDailyLimit('assistant', { AI_DAILY_LIMIT_ASSISTANT: 'lots' })).toBeNull();
    expect(aiDailyLimit('assistant', { AI_DAILY_LIMIT_ASSISTANT: '-3' })).toBeNull();
  });
});

describe('spendAiAllowance', () => {
  const db = useTestDatabase();
  const env = { AI_DAILY_LIMIT_ASSISTANT: '2', AI_DAILY_LIMIT_OCR: '1' };

  it('lets every call through, and records nothing, when the feature has no limit', async () => {
    const { tenant } = await seedHousehold(db.em());
    for (let i = 0; i < 5; i++) {
      expect(await spendAiAllowance(db.em(), tenant.tenantKey, 'csvMapping', { env, now: NOON })).toBe(true);
    }
    expect(await db.em().count(AiUsageAllowance, {})).toBe(0);
  });

  it('allows a household its daily allowance and refuses the call after it', async () => {
    const { tenant } = await seedHousehold(db.em());
    expect(await spendAiAllowance(db.em(), tenant.tenantKey, 'assistant', { env, now: NOON })).toBe(true);
    expect(await spendAiAllowance(db.em(), tenant.tenantKey, 'assistant', { env, now: NOON })).toBe(true);
    expect(await spendAiAllowance(db.em(), tenant.tenantKey, 'assistant', { env, now: NOON })).toBe(false);
  });

  it('starts a fresh allowance on the next UTC day', async () => {
    const { tenant } = await seedHousehold(db.em());
    expect(await spendAiAllowance(db.em(), tenant.tenantKey, 'ocr', { env, now: NOON })).toBe(true);
    expect(await spendAiAllowance(db.em(), tenant.tenantKey, 'ocr', { env, now: NOON })).toBe(false);
    expect(await spendAiAllowance(db.em(), tenant.tenantKey, 'ocr', { env, now: NEXT_DAY })).toBe(true);
  });

  it('keeps each feature and each household to its own allowance', async () => {
    const first = await seedHousehold(db.em());
    const second = await seedHousehold(db.em());
    expect(await spendAiAllowance(db.em(), first.tenant.tenantKey, 'ocr', { env, now: NOON })).toBe(true);
    expect(await spendAiAllowance(db.em(), first.tenant.tenantKey, 'ocr', { env, now: NOON })).toBe(false);

    expect(await spendAiAllowance(db.em(), first.tenant.tenantKey, 'assistant', { env, now: NOON })).toBe(true);
    expect(await spendAiAllowance(db.em(), second.tenant.tenantKey, 'ocr', { env, now: NOON })).toBe(true);
  });

  it('refuses every call when the limit is zero', async () => {
    const { tenant } = await seedHousehold(db.em());
    expect(await spendAiAllowance(db.em(), tenant.tenantKey, 'ocr', { env: { AI_DAILY_LIMIT_OCR: '0' }, now: NOON })).toBe(false);
  });
});
