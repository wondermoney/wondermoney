/**
 * Locale rule presets: short, reviewed rule packs that recognise well-known national merchants
 * and utilities (Continente is groceries, EDP is electricity) for a new household.
 *
 * Each preset is a `wondermoney-rules` file (the rules export/import format, version 1) with a
 * `preset` block naming its code, language, countries and revision. Categories are system
 * categories by key, so a preset installs the same way into every household. The API serves them
 * (`GET /v1/rule/presets`) and installs one through the rules importer, which validates it
 * against the export schema like any uploaded file.
 *
 * What a preset may do is deliberately narrow, and `findRulePresetViolations` enforces it over
 * every preset file in CI:
 *
 * - only `set_category`, `set_merchant` and `set_description`: never a transaction type (only
 *   transfer matching marks transfers), never `hide`, tags, notes or reviews;
 * - a rule that sets a spending category also requires money out, so a refund, a salary or a
 *   payment from a friend is never recategorised as spending;
 * - a payment rail (MB WAY, PIX, Bizum, SEPA, a transfer) is never mapped to a category, because
 *   it carries income and spending alike. Securo's Brazil pack marked incoming PIX payments as
 *   transfers and silently dropped real income from reports; this is the guard against that.
 *
 * Plain data and pure functions, no dependencies.
 */
import en from './en.json';
import esES from './es-ES.json';
import ptBR from './pt-BR.json';
import ptPT from './pt-PT.json';

export const RULE_PRESET_FORMAT = 'wondermoney-rules';
export const RULE_PRESET_FORMAT_VERSION = 1;

/** The only actions a preset rule may use. */
export const RULE_PRESET_ALLOWED_ACTIONS = ['set_category', 'set_merchant', 'set_description'] as const;
export type RulePresetActionType = (typeof RULE_PRESET_ALLOWED_ACTIONS)[number];

/** The only conditions a preset rule may use: none of them names a household's own rows. */
export const RULE_PRESET_ALLOWED_CONDITION_FIELDS = ['description', 'merchant', 'direction', 'amount', 'currency'] as const;

/** System categories (by key) that hold income. A rule may only put money in into one of these. */
export const INCOME_SYSTEM_CATEGORY_KEYS: readonly string[] = ['INCOME', 'SALARY'];

/**
 * Names of payment rails and transfer wording, compared as whole words after case, accents and
 * punctuation are set aside. Money moves both ways on all of them, so none may decide a category.
 */
export const PAYMENT_RAIL_TERMS: readonly string[] = [
  'mb way',
  'mbway',
  'multibanco',
  'pix',
  'ted',
  'doc',
  'boleto',
  'bizum',
  'sepa',
  'transfer',
  'transfers',
  'transferencia',
  'transferencias',
  'transf',
  'trf',
  'wire',
  'faster payment',
  'faster payments',
  'bacs',
  'chaps',
  'standing order',
  'direct debit',
  'ach',
  'zelle',
  'venmo',
  'cash app',
  'paypal',
  'revolut',
  'wise',
  'mercado pago',
  'picpay',
];

export type RulePresetCategory = { system: string } | { name: string } | string;

export type RulePresetCondition =
  | { field: 'description'; operator: string; source?: 'cleaned' | 'raw'; value: string }
  | { field: 'merchant'; operator: string; value: string }
  | { field: 'direction'; operator: 'is'; value: 'in' | 'out' }
  | { field: string; operator: string; [key: string]: unknown };

export type RulePresetAction =
  | { category: RulePresetCategory; type: 'set_category' }
  | { merchant: string; type: 'set_merchant' }
  | { type: 'set_description'; value: string }
  | { type: string; [key: string]: unknown };

export interface RulePresetRule {
  actions: RulePresetAction[];
  active?: boolean;
  conditions: RulePresetCondition[];
  match?: 'all' | 'any';
  name: string;
  stopProcessing?: boolean;
}

export interface RulePresetMeta {
  /** A BCP 47 tag: a language, or a language and country (`pt-PT`). */
  code: string;
  /** ISO 3166-1 alpha-2 countries whose merchants the preset knows. */
  countries: string[];
  /** ISO 639-1 language of the people the preset is for. */
  language: string;
  /** Bumped whenever the rules change. */
  revision: number;
}

/** A preset file: a `wondermoney-rules` export with a `preset` block. */
export interface RulePreset {
  format: typeof RULE_PRESET_FORMAT;
  preset: RulePresetMeta;
  rules: RulePresetRule[];
  version: typeof RULE_PRESET_FORMAT_VERSION;
}

/** Every preset that ships, by code. */
export const RULE_PRESETS: readonly RulePreset[] = [ptPT, esES, ptBR, en] as RulePreset[];

export function getRulePreset(code: string): RulePreset | undefined {
  const wanted = code.trim().toLowerCase();
  return RULE_PRESETS.find((preset) => preset.preset.code.toLowerCase() === wanted);
}

/**
 * The preset a language falls back to when no country settles it: the language's home market,
 * where the merchants in the list are.
 */
const LANGUAGE_DEFAULT_PRESET: Readonly<Record<string, string>> = { en: 'en', es: 'es-ES', pt: 'pt-PT' };

/** Countries a currency belongs to without doubt. The euro says nothing about the country. */
const CURRENCY_COUNTRY: Readonly<Record<string, string>> = { BRL: 'BR', GBP: 'GB', USD: 'US' };

export interface RulePresetSignals {
  /** Countries of the person's bank connections, the strongest signal of where they spend. */
  bankCountries?: readonly (null | string | undefined)[];
  /** The person's main currency (ISO 4217). */
  currency?: null | string;
  /** The app's language or a locale (`pt`, `pt-BR`); a locale's country counts as a region. */
  language?: null | string;
  /** The device or browser region (ISO 3166-1 alpha-2), when known. */
  region?: null | string;
}

/**
 * The preset to offer someone, or `undefined` when none fits.
 *
 * Countries decide first, strongest first: bank connections, the locale's own country, the
 * device region, then a currency that names one country. The first country a preset covers
 * wins; when two presets cover it, the one in the person's language does. Only when no country
 * is known does the language alone choose (Portuguese → Portugal, Spanish → Spain, English → the
 * UK/US list). A known country no preset covers (Spanish in Mexico) offers nothing: a list of
 * another country's shops would only add noise.
 */
export function matchRulePreset(signals: RulePresetSignals, presets: readonly RulePreset[] = RULE_PRESETS): RulePreset | undefined {
  const [languagePart, localeRegion] = (signals.language ?? '').trim().replace('_', '-').split('-');
  const language = languagePart?.toLowerCase() || undefined;
  const currencyCountry = signals.currency ? CURRENCY_COUNTRY[signals.currency.trim().toUpperCase()] : undefined;

  const countries = [...(signals.bankCountries ?? []), localeRegion, signals.region, currencyCountry]
    .map((country) => country?.trim().toUpperCase())
    .filter((country): country is string => !!country && /^[A-Z]{2}$/.test(country));

  for (const country of countries) {
    const covering = presets.filter((preset) => preset.preset.countries.includes(country));
    if (covering.length === 0) continue;
    return covering.find((preset) => preset.preset.language === language) ?? covering[0];
  }
  if (countries.length > 0 || !language) return undefined;

  const fallback = LANGUAGE_DEFAULT_PRESET[language];
  return fallback ? presets.find((preset) => preset.preset.code === fallback) : undefined;
}

export type RulePresetViolationKind =
  | 'action-not-allowed'
  | 'condition-not-allowed'
  | 'custom-category'
  | 'duplicate-name'
  | 'hides-transaction'
  | 'incoming-money-to-non-income-category'
  | 'invalid-file'
  | 'payment-rail-to-category'
  | 'sets-transaction-type';

export interface RulePresetViolation {
  kind: RulePresetViolationKind;
  message: string;
  /** The rule's name, or `undefined` for a problem with the file itself. */
  rule?: string;
}

/** Words as the rail check compares them: lower case, no accents, no punctuation. */
function words(value: string): string {
  return ` ${value
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()} `;
}

const RAIL_WORDS = PAYMENT_RAIL_TERMS.map(words);

/** The payment-rail terms `text` contains as whole words. */
export function findPaymentRailTerms(text: string): string[] {
  const haystack = words(text);
  return PAYMENT_RAIL_TERMS.filter((_, index) => haystack.includes(RAIL_WORDS[index] ?? ''));
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Every text a condition compares against, for the rail check. */
function conditionTexts(condition: Record<string, unknown>): string[] {
  const texts: string[] = [];
  if (typeof condition['value'] === 'string') texts.push(condition['value']);
  if (Array.isArray(condition['values'])) for (const value of condition['values']) if (typeof value === 'string') texts.push(value);
  return texts;
}

/**
 * Everything wrong with a preset, judged against the rules in this module's header. An empty
 * list means it is safe to ship. Accepts unknown input so a malformed file is reported, not
 * thrown.
 */
export function findRulePresetViolations(file: unknown): RulePresetViolation[] {
  const violations: RulePresetViolation[] = [];
  const fail = (kind: RulePresetViolationKind, message: string, rule?: string) => violations.push({ kind, message, rule });

  if (!isRecord(file) || file['format'] !== RULE_PRESET_FORMAT || file['version'] !== RULE_PRESET_FORMAT_VERSION) {
    fail('invalid-file', `A preset is a ${RULE_PRESET_FORMAT} file, version ${RULE_PRESET_FORMAT_VERSION}`);
    return violations;
  }
  const meta = file['preset'];
  if (
    !isRecord(meta) ||
    typeof meta['code'] !== 'string' ||
    typeof meta['language'] !== 'string' ||
    typeof meta['revision'] !== 'number' ||
    !Array.isArray(meta['countries'])
  ) {
    fail('invalid-file', 'The preset block needs a code, a language, countries and a revision');
  }
  if (!Array.isArray(file['rules']) || file['rules'].length === 0) {
    fail('invalid-file', 'A preset needs at least one rule');
    return violations;
  }

  const names = new Set<string>();
  for (const candidate of file['rules']) {
    if (!isRecord(candidate) || typeof candidate['name'] !== 'string' || !Array.isArray(candidate['conditions']) || !Array.isArray(candidate['actions'])) {
      fail('invalid-file', 'Each rule needs a name, conditions and actions');
      continue;
    }
    const name = candidate['name'];
    const key = name.trim().toLowerCase();
    if (names.has(key)) fail('duplicate-name', 'Two rules have this name; installing skips rules by name', name);
    names.add(key);

    const conditions = candidate['conditions'].filter(isRecord);
    const actions = candidate['actions'].filter(isRecord);
    const matchAll = (candidate['match'] ?? 'all') === 'all';

    for (const condition of conditions) {
      const field = String(condition['field']);
      if (!(RULE_PRESET_ALLOWED_CONDITION_FIELDS as readonly string[]).includes(field)) {
        fail('condition-not-allowed', `A preset cannot use a ${field} condition`, name);
      }
    }

    for (const action of actions) {
      const type = String(action['type']);
      if (type === 'hide') fail('hides-transaction', 'A preset never hides a transaction', name);
      if (/type|transfer/i.test(type) || Object.keys(action).some((field) => field !== 'type' && /type|transfer/i.test(field))) {
        fail('sets-transaction-type', 'A preset never sets a transaction type; only transfer matching marks transfers', name);
      }
      if (!(RULE_PRESET_ALLOWED_ACTIONS as readonly string[]).includes(type)) {
        fail('action-not-allowed', `A preset may only use ${RULE_PRESET_ALLOWED_ACTIONS.join(', ')}; this rule uses ${type}`, name);
      }
    }

    const setCategory = actions.find((action) => action['type'] === 'set_category');
    if (!setCategory) continue;

    const category = setCategory['category'];
    const systemKey = isRecord(category) && typeof category['system'] === 'string' ? category['system'].toUpperCase() : undefined;
    if (!systemKey) fail('custom-category', 'A preset names categories by system key, so it installs the same in every household', name);

    const moneyOut = matchAll && conditions.some((condition) => condition['field'] === 'direction' && condition['operator'] === 'is' && condition['value'] === 'out');
    const moneyIn = matchAll && conditions.some((condition) => condition['field'] === 'direction' && condition['operator'] === 'is' && condition['value'] === 'in');
    const income = systemKey !== undefined && INCOME_SYSTEM_CATEGORY_KEYS.includes(systemKey);
    if (!income && !moneyOut) {
      fail('incoming-money-to-non-income-category', 'A rule that sets a spending category must match all conditions, one of them money out', name);
    }
    if (income && !moneyIn) {
      fail('incoming-money-to-non-income-category', 'A rule that sets an income category must match all conditions, one of them money in', name);
    }

    for (const condition of conditions) {
      for (const text of conditionTexts(condition)) {
        const rails = findPaymentRailTerms(text);
        if (rails.length > 0) fail('payment-rail-to-category', `"${text}" names a payment rail (${rails.join(', ')}); rails carry income and spending alike`, name);
      }
    }
  }

  return violations;
}
