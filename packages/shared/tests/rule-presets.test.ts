import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  findPaymentRailTerms,
  findRulePresetViolations,
  getRulePreset,
  matchRulePreset,
  RULE_PRESETS,
  type RulePreset,
  type RulePresetViolationKind,
} from '../lib/rule-presets';

/*
 * Locale rule presets are installed into real households, so a bad one quietly miscategorises
 * money: Securo's Brazil pack marked incoming PIX payments as transfers and dropped real income
 * from reports. Every file in the presets directory is checked here, registered or not.
 */
const PRESET_DIRECTORY = join(__dirname, '..', 'lib', 'rule-presets');
const presetFiles = readdirSync(PRESET_DIRECTORY).filter((name) => name.endsWith('.json'));

describe('every shipped rule preset', () => {
  it('finds the preset files', () => {
    expect(presetFiles.length).toBeGreaterThanOrEqual(3);
  });

  it.each(presetFiles)('%s never touches income, transfers or hidden rows', (fileName) => {
    const file: unknown = JSON.parse(readFileSync(join(PRESET_DIRECTORY, fileName), 'utf8'));
    expect(findRulePresetViolations(file)).toEqual([]);
  });

  it.each(presetFiles)('%s is named after its code and ships', (fileName) => {
    const file = JSON.parse(readFileSync(join(PRESET_DIRECTORY, fileName), 'utf8')) as RulePreset;
    expect(`${file.preset.code}.json`).toBe(fileName);
    expect(getRulePreset(file.preset.code)).toEqual(file);
  });

  it.each(presetFiles)('%s stays a short list', (fileName) => {
    const file = JSON.parse(readFileSync(join(PRESET_DIRECTORY, fileName), 'utf8')) as RulePreset;
    expect(file.rules.length).toBeGreaterThanOrEqual(10);
    expect(file.rules.length).toBeLessThanOrEqual(25);
  });

  it('covers Portugal, Spain, Brazil and English', () => {
    expect(RULE_PRESETS.map((preset) => preset.preset.code).sort()).toEqual(['en', 'es-ES', 'pt-BR', 'pt-PT']);
  });
});

describe('the preset safety check', () => {
  const rule = (overrides: Record<string, unknown> = {}) => ({
    actions: [{ category: { system: 'GROCERIES' }, type: 'set_category' }],
    conditions: [
      { field: 'direction', operator: 'is', value: 'out' },
      { field: 'description', operator: 'contains', source: 'raw', value: 'Continente' },
    ],
    match: 'all',
    name: 'Continente',
    ...overrides,
  });
  const presetWith = (...rules: Record<string, unknown>[]) => ({
    format: 'wondermoney-rules',
    preset: { code: 'xx-XX', countries: ['XX'], language: 'xx', revision: 1 },
    rules,
    version: 1,
  });
  const kinds = (file: unknown): RulePresetViolationKind[] => findRulePresetViolations(file).map((violation) => violation.kind);

  it('accepts a spending rule limited to money out', () => {
    expect(kinds(presetWith(rule()))).toEqual([]);
  });

  it('refuses a rule that sets a transaction type', () => {
    expect(kinds(presetWith(rule({ actions: [{ type: 'set_transaction_type', value: 'TRANSFER_IN' }] })))).toEqual(expect.arrayContaining(['sets-transaction-type', 'action-not-allowed']));
    expect(kinds(presetWith(rule({ actions: [{ category: { system: 'GROCERIES' }, transactionType: 'TRANSFER_IN', type: 'set_category' }] })))).toContain('sets-transaction-type');
  });

  it('refuses a rule that hides transactions', () => {
    expect(kinds(presetWith(rule({ actions: [{ type: 'hide' }] })))).toEqual(expect.arrayContaining(['hides-transaction', 'action-not-allowed']));
  });

  it('refuses any action beyond category, merchant and description', () => {
    for (const action of [{ tags: ['x'], type: 'add_tags' }, { type: 'mark_reviewed' }, { type: 'set_notes', value: 'x' }]) {
      expect(kinds(presetWith(rule({ actions: [action] })))).toEqual(['action-not-allowed']);
    }
    expect(kinds(presetWith(rule({ actions: [{ merchant: 'Continente', type: 'set_merchant' }, { type: 'set_description', value: 'Continente' }] })))).toEqual([]);
  });

  it('refuses a spending category on money that may be coming in', () => {
    const onlyDescription = [{ field: 'description', operator: 'contains', value: 'Continente' }];
    expect(kinds(presetWith(rule({ conditions: onlyDescription })))).toEqual(['incoming-money-to-non-income-category']);
    expect(kinds(presetWith(rule({ conditions: [{ field: 'direction', operator: 'is', value: 'in' }, ...onlyDescription] })))).toEqual(['incoming-money-to-non-income-category']);
    // With "any", the direction no longer limits what the rule matches.
    expect(kinds(presetWith(rule({ match: 'any' })))).toEqual(['incoming-money-to-non-income-category']);
  });

  it('allows an income category only on money in', () => {
    const salary = { actions: [{ category: { system: 'SALARY' }, type: 'set_category' }] };
    expect(kinds(presetWith(rule({ ...salary, conditions: [{ field: 'direction', operator: 'is', value: 'in' }, { field: 'description', operator: 'contains', value: 'Payroll' }] })))).toEqual([]);
    expect(kinds(presetWith(rule(salary)))).toEqual(['incoming-money-to-non-income-category']);
  });

  it('refuses to categorise by a payment rail name', () => {
    for (const value of ['MB WAY', 'Compra MBWAY', 'PIX recebido', 'Bizum', 'SEPA Credit', 'Transferência', 'TRF 1234', 'Faster Payment']) {
      expect(kinds(presetWith(rule({ conditions: [{ field: 'direction', operator: 'is', value: 'out' }, { field: 'description', operator: 'contains', value }] })))).toEqual(['payment-rail-to-category']);
    }
  });

  it('reads rail names as whole words, not inside merchant names', () => {
    expect(findPaymentRailTerms('PIXEL STORE')).toEqual([]);
    expect(findPaymentRailTerms('Transfer to savings')).toEqual(['transfer']);
    expect(findPaymentRailTerms('pagamento pix')).toEqual(['pix']);
  });

  it('refuses household-specific references, duplicate names and malformed files', () => {
    expect(kinds(presetWith(rule({ actions: [{ category: { name: 'Groceries' }, type: 'set_category' }] })))).toEqual(['custom-category']);
    expect(kinds(presetWith(rule({ conditions: [...rule().conditions, { field: 'account', operator: 'in', values: ['Current'] }] })))).toEqual(['condition-not-allowed']);
    expect(kinds(presetWith(rule(), rule()))).toEqual(['duplicate-name']);
    expect(kinds({ format: 'something-else', rules: [] })).toEqual(['invalid-file']);
    expect(kinds(presetWith())).toEqual(['invalid-file']);
  });
});

describe('matching a person to a preset', () => {
  const code = (signals: Parameters<typeof matchRulePreset>[0]) => matchRulePreset(signals)?.preset.code;

  it('follows the language when nothing says where the person is', () => {
    expect(code({ language: 'pt' })).toBe('pt-PT');
    expect(code({ language: 'es' })).toBe('es-ES');
    expect(code({ language: 'en' })).toBe('en');
  });

  it('lets a locale country choose between presets of one language', () => {
    expect(code({ language: 'pt-BR' })).toBe('pt-BR');
    expect(code({ language: 'pt_PT' })).toBe('pt-PT');
    expect(code({ language: 'en-GB' })).toBe('en');
  });

  it('reads a device region and a single-country currency', () => {
    expect(code({ language: 'pt', region: 'BR' })).toBe('pt-BR');
    expect(code({ currency: 'BRL', language: 'pt' })).toBe('pt-BR');
    expect(code({ currency: 'EUR', language: 'pt' })).toBe('pt-PT');
  });

  it('puts where the person banks before the language they read in', () => {
    expect(code({ bankCountries: ['PT'], language: 'en', region: 'US' })).toBe('pt-PT');
    expect(code({ bankCountries: ['es'], language: 'en' })).toBe('es-ES');
  });

  it('offers nothing for a country no preset covers, or with no signal at all', () => {
    expect(code({ language: 'es-MX' })).toBeUndefined();
    expect(code({ language: 'fr' })).toBeUndefined();
    expect(code({ language: 'pt', region: 'AO' })).toBeUndefined();
    expect(code({})).toBeUndefined();
  });

  it('skips an uncovered country to reach a covered one', () => {
    expect(code({ bankCountries: ['FR'], language: 'pt', region: 'PT' })).toBe('pt-PT');
  });
});
