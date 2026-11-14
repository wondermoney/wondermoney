import type { EntityManager } from '@mikro-orm/postgresql';
import { getRulePreset, matchRulePreset, RULE_PRESETS, type RulePreset, type RulePresetSignals } from '@wondermoney/shared';

import { Appuser } from '@entity/Appuser';
import { Currency } from '@entity/Currency';
import { EnableBankingConnection } from '@entity/EnableBankingConnection';
import { Rule } from '@entity/Rule';
import { Tenant } from '@entity/Tenant';
import { getRef } from '@utils/em-helpers';
import { NotFoundError } from '@utils/errors';

import type { ExportedRule } from './rule-export.schema';
import { importRules, parseImportFile, type RuleImportResult, type RuleImportUnresolved } from './rule-import.service';
import type { Actor } from './rule.service';

/**
 * Locale rule presets (`@wondermoney/shared`'s `rule-presets`): short lists of well-known
 * national merchants a household can add to its rules in one go.
 *
 * A preset is a `wondermoney-rules` file, so it goes through the rules importer exactly like an
 * uploaded file: validated against the export schema, its system categories resolved by key,
 * appended after the household's own rules, and skipped rule by rule when the household already
 * has a rule with that name. Installing twice therefore adds nothing the second time. The preview
 * is the importer's dry run over the same file, so what it lists is what installing creates.
 *
 * Nothing here installs on its own: the clients offer the preset that matches the person and
 * install only when asked. What a preset may contain (no transfers, no hiding, never income
 * recategorised as spending, never a payment rail mapped to a category) is checked in CI over
 * every preset file.
 */

export interface RulePresetList {
  presets: RulePresetSummary[];
  /** The preset that matches the person's language and country, if any. */
  suggested: null | string;
}

export interface RulePresetSummary {
  code: string;
  countries: string[];
  /** Every rule in the preset is in the household (by name). */
  installed: boolean;
  /** Preset rules the household already has a rule of the same name for. */
  installedCount: number;
  language: string;
  revision: number;
  ruleCount: number;
}

/** `new` installs; `installed` is skipped as already there; `unavailable` names a missing category. */
export interface RulePresetInstallResult {
  /** Names of the rules created, in the order they now run. */
  created: string[];
  preset: RulePresetSummary;
  /** Names of the rules skipped because the household already had them. */
  skipped: string[];
  unresolved: RuleImportUnresolved[];
}

export interface RulePresetLocale {
  language?: string;
  region?: string;
}

export interface RulePresetPreview {
  preset: RulePresetSummary;
  /** The preset's rules, in file order, each with what installing would do with it. */
  rules: (ExportedRule & { status: RulePresetRuleStatus })[];
}

export type RulePresetRuleStatus = 'installed' | 'new' | 'unavailable';

const normalize = (value: string) => value.trim().toLocaleLowerCase();

function findPreset(code: string): RulePreset {
  const preset = getRulePreset(code);
  if (!preset) throw new NotFoundError(`No rule preset "${code}"`);
  return preset;
}

async function householdRuleNames(em: EntityManager, tenantKey: number): Promise<Set<string>> {
  const rules = await em.find(Rule, { deletedAt: null, tenantKey: getRef(em, Tenant, tenantKey) }, { fields: ['name'] });
  return new Set(rules.map((rule) => normalize(rule.name)));
}

function summarize(preset: RulePreset, ruleNames: Set<string>): RulePresetSummary {
  const installedCount = preset.rules.filter((rule) => ruleNames.has(normalize(rule.name))).length;
  return {
    code: preset.preset.code,
    countries: preset.preset.countries,
    installed: installedCount === preset.rules.length,
    installedCount,
    language: preset.preset.language,
    revision: preset.preset.revision,
    ruleCount: preset.rules.length,
  };
}

/**
 * What the server knows about where the person is, added to what the client says: the countries
 * of their own bank connections and their currency. The client's locale comes first in the
 * language; its region and the device region count as countries after the bank's.
 */
async function presetSignals(em: EntityManager, actor: Actor, locale: RulePresetLocale): Promise<RulePresetSignals> {
  const [appuser, connections] = await Promise.all([
    em.findOne(Appuser, { appuserKey: actor.appuserKey }, { fields: ['currencyKey', 'language'] }),
    em.find(
      EnableBankingConnection,
      { appuserKey: getRef(em, Appuser, actor.appuserKey), deletedAt: null, tenantKey: getRef(em, Tenant, actor.tenantKey) },
      { fields: ['aspspCountry'], orderBy: { createdAt: 'desc' } },
    ),
  ]);
  const currency = appuser?.currencyKey ? await em.findOne(Currency, { currencyKey: appuser.currencyKey.currencyKey }, { fields: ['code'] }) : null;

  return {
    bankCountries: connections.map((connection) => connection.aspspCountry),
    currency: currency?.code ?? null,
    language: locale.language ?? appuser?.language.toLowerCase() ?? null,
    region: locale.region ?? null,
  };
}

/** Every preset with its rule count and how much of it the household has, plus the one to offer. */
export async function listRulePresets(em: EntityManager, actor: Actor, locale: RulePresetLocale = {}): Promise<RulePresetList> {
  const [ruleNames, signals] = await Promise.all([householdRuleNames(em, actor.tenantKey), presetSignals(em, actor, locale)]);
  return {
    presets: RULE_PRESETS.map((preset) => summarize(preset, ruleNames)),
    suggested: matchRulePreset(signals)?.preset.code ?? null,
  };
}

const dryRun = (em: EntityManager, actor: Actor, preset: RulePreset): Promise<RuleImportResult> =>
  importRules(em, actor, preset, { confirm: false, createCategories: false, dryRun: true, mode: 'append' });

/** The preset's full contents and, rule by rule, what installing it now would do. Writes nothing. */
export async function previewRulePreset(em: EntityManager, actor: Actor, code: string): Promise<RulePresetPreview> {
  const preset = findPreset(code);
  const file = parseImportFile(preset);
  const [plan, ruleNames] = await Promise.all([dryRun(em, actor, preset), householdRuleNames(em, actor.tenantKey)]);
  const duplicates = new Set(plan.duplicates.map((rule) => normalize(rule.name)));
  const unavailable = new Set(plan.unresolved.map((reference) => normalize(reference.ruleName)));

  return {
    preset: summarize(preset, ruleNames),
    rules: file.rules.map((rule) => {
      const key = normalize(rule.name);
      const status: RulePresetRuleStatus = duplicates.has(key) ? 'installed' : unavailable.has(key) ? 'unavailable' : 'new';
      return { ...rule, status };
    }),
  };
}

/** Append the preset's rules the household does not have yet. Installing again adds nothing. */
export async function installRulePreset(em: EntityManager, actor: Actor, code: string): Promise<RulePresetInstallResult> {
  const preset = findPreset(code);
  const result = await importRules(em, actor, preset, { confirm: false, createCategories: false, dryRun: false, mode: 'append' });
  return {
    created: result.creates.map((rule) => rule.name),
    preset: summarize(preset, await householdRuleNames(em, actor.tenantKey)),
    skipped: result.duplicates.map((rule) => rule.name),
    unresolved: result.unresolved,
  };
}
