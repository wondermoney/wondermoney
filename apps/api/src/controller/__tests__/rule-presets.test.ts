import type { Dictionary } from '@mikro-orm/core';
import { RULE_PRESETS } from '@wondermoney/shared';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('@service/auth/better-auth', async () => (await import('@app/__tests__/__helpers__/auth-session-double')).mockAuthSession());

import { addPartner, currencyFor, type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { tenantHttp, useRequestContextEm } from '@app/__tests__/__helpers__/tenant-http';
import { CategorySeeder } from '@app/database/seeders/CategorySeeder';
import { SubCategorySeeder } from '@app/database/seeders/SubcategorySeeder';
import { Appuser, SupportedLanguages } from '@entity/Appuser';
import { Category } from '@entity/Category';
import { EnableBankingConnection, EnableBankingConnectionStatus } from '@entity/EnableBankingConnection';
import { EnableBankingCredential } from '@entity/EnableBankingCredential';
import { Rule } from '@entity/Rule';
import ruleRoutes from '@route/rule';

/*
 * Locale rule presets: a household can see everything a preset would add before adding it, and
 * adding it twice adds nothing the second time. Installing goes through the rules importer, so
 * the preview and the install agree by construction; these tests hold them to it.
 */
describe('rule presets', () => {
  const db = useTestDatabase();
  useRequestContextEm(db);
  const rules = tenantHttp('/v1/rule', ruleRoutes);

  interface PresetSummary { code: string; installed: boolean; installedCount: number; ruleCount: number }
  interface PreviewRule { actions: { category?: { system: string }; type: string }[]; conditions: unknown[]; name: string; status: 'installed' | 'new' | 'unavailable' }

  /** The real system categories, as a new instance seeds them. */
  async function seedSystemCategories() {
    const em = db.em();
    const context: Dictionary = {};
    await new CategorySeeder().run(em, context);
    await new SubCategorySeeder().run(em, context);
    await em.flush();
  }

  const liveRules = (household: Household) =>
    db.em().find(Rule, { deletedAt: null, tenantKey: household.tenant }, { orderBy: { position: 'asc' } });

  const list = async (user: Appuser, query = '') => {
    const response = await rules.as(user).get(`/v1/rule/presets${query}`);
    expect(response.status).toBe(200);
    return response.body as { presets: PresetSummary[]; suggested: null | string };
  };

  const preview = async (user: Appuser, code: string) => {
    const response = await rules.as(user).get(`/v1/rule/presets/${code}`);
    expect(response.status).toBe(200);
    return response.body as { preset: PresetSummary; rules: PreviewRule[] };
  };

  const install = async (user: Appuser, code: string) => {
    const response = await rules.as(user).post(`/v1/rule/presets/${code}/install`).send({});
    expect(response.status).toBe(200);
    return response.body as { created: string[]; preset: PresetSummary; skipped: string[]; unresolved: unknown[] };
  };

  it('installs every shipped preset in full into a household with the system categories', async () => {
    await seedSystemCategories();
    for (const preset of RULE_PRESETS) {
      const household = await seedHousehold(db.em());

      const result = await install(household.appuser, preset.preset.code);

      expect(result.unresolved).toEqual([]);
      expect(result.created).toHaveLength(preset.rules.length);
      expect((await liveRules(household)).map((rule) => rule.name)).toEqual(preset.rules.map((rule) => rule.name));
    }
  });

  it('only ever sets a selectable spending category, never an income one', async () => {
    await seedSystemCategories();
    const em = db.em();
    const incomeKeys = new Set((await em.find(Category, { $or: [{ name: 'INCOME' }, { parentCategory: { name: 'INCOME' } }], isSystemCategory: true })).map((category) => category.categoryKey));
    const parents = new Set((await em.find(Category, { isSystemCategory: true, parentCategory: { $ne: null } }, { populate: ['parentCategory'] })).map((category) => category.parentCategory?.categoryKey));
    const household = await seedHousehold(db.em());

    for (const preset of RULE_PRESETS) await install(household.appuser, preset.preset.code);

    const categoryKeys = (await liveRules(household)).flatMap((rule) => rule.actions.flatMap((action) => (action.type === 'set_category' ? [action.categoryId] : [])));
    expect(categoryKeys.length).toBeGreaterThan(0);
    for (const key of categoryKeys) {
      expect(incomeKeys.has(key)).toBe(false);
      // A system parent is a heading the category pickers do not offer.
      expect(parents.has(key)).toBe(false);
    }
  });

  it('adds nothing when the same preset is installed again', async () => {
    await seedSystemCategories();
    const household = await seedHousehold(db.em());

    const first = await install(household.appuser, 'pt-PT');
    const second = await install(household.appuser, 'pt-PT');

    expect(first.created.length).toBeGreaterThan(0);
    expect(second.created).toEqual([]);
    expect(second.skipped).toEqual(first.created);
    expect(second.preset).toMatchObject({ installed: true, installedCount: first.created.length });
    expect(await liveRules(household)).toHaveLength(first.created.length);
  });

  it('appends after the household\'s rules and skips the ones it already has by name', async () => {
    await seedSystemCategories();
    const household = await seedHousehold(db.em());
    const own = await rules.as(household.appuser).post('/v1/rule').send({
      actions: [{ type: 'mark_reviewed' }],
      conditions: [{ field: 'merchant', operator: 'contains', value: 'continente' }],
      name: 'Continente',
    });
    expect(own.status).toBe(201);

    const result = await install(household.appuser, 'pt-PT');

    const names = (await liveRules(household)).map((rule) => rule.name);
    expect(names[0]).toBe('Continente');
    expect(names.filter((name) => name === 'Continente')).toHaveLength(1);
    expect(result.skipped).toEqual(['Continente']);
    expect(names.slice(1)).toEqual(result.created);
  });

  it('previews exactly what installing creates, and writes nothing', async () => {
    await seedSystemCategories();
    const household = await seedHousehold(db.em());
    await install(household.appuser, 'es-ES');
    // The person deletes one of the preset's rules; the preview now offers only that one back.
    const [removed] = await liveRules(household);
    expect((await rules.as(household.appuser).delete(`/v1/rule/${removed?.ruleKey}`)).status).toBe(200);

    const shown = await preview(household.appuser, 'es-ES');
    const before = await liveRules(household);
    const result = await install(household.appuser, 'es-ES');

    expect(before).toHaveLength(shown.rules.length - 1);
    expect(shown.rules.filter((rule) => rule.status === 'new').map((rule) => rule.name)).toEqual(result.created);
    expect(result.created).toEqual([removed?.name]);
    expect(shown.rules.filter((rule) => rule.status === 'installed').map((rule) => rule.name)).toEqual(result.skipped);
  });

  it('shows the full contents of a preset, by system category key', async () => {
    await seedSystemCategories();
    const household = await seedHousehold(db.em());
    const portugal = RULE_PRESETS.find((preset) => preset.preset.code === 'pt-PT');

    const shown = await preview(household.appuser, 'pt-pt');

    expect(shown.preset).toMatchObject({ code: 'pt-PT', installed: false, installedCount: 0, ruleCount: portugal?.rules.length });
    expect(shown.rules.map((rule) => rule.name)).toEqual(portugal?.rules.map((rule) => rule.name));
    expect(shown.rules.every((rule) => rule.status === 'new')).toBe(true);
    expect(shown.rules.find((rule) => rule.name === 'Continente')?.actions).toContainEqual({ category: { system: 'GROCERIES' }, type: 'set_category' });
    expect(await liveRules(household)).toEqual([]);
  });

  it('marks a rule whose category the instance lacks as unavailable, and leaves it out', async () => {
    const household = await seedHousehold(db.em());

    const shown = await preview(household.appuser, 'en');
    const result = await install(household.appuser, 'en');

    expect(shown.rules.every((rule) => rule.status === 'unavailable')).toBe(true);
    expect(result.created).toEqual([]);
    expect(await liveRules(household)).toEqual([]);
  });

  it('answers 404 for a preset that does not exist, and 400 for a malformed code', async () => {
    const household = await seedHousehold(db.em());

    expect((await rules.as(household.appuser).get('/v1/rule/presets/fr-FR')).status).toBe(404);
    expect((await rules.as(household.appuser).post('/v1/rule/presets/fr-FR/install').send({})).status).toBe(404);
    expect((await rules.as(household.appuser).get('/v1/rule/presets/not a code')).status).toBe(400);
  });

  describe('tenancy', () => {
    it('installs into the caller\'s household only, and reports status per household', async () => {
      await seedSystemCategories();
      const ours = await seedHousehold(db.em());
      const theirs = await seedHousehold(db.em());

      const result = await install(ours.appuser, 'pt-BR');

      expect(await liveRules(ours)).toHaveLength(result.created.length);
      expect(await liveRules(theirs)).toEqual([]);
      expect((await list(ours.appuser)).presets.find((preset) => preset.code === 'pt-BR')).toMatchObject({ installed: true });
      expect((await list(theirs.appuser)).presets.find((preset) => preset.code === 'pt-BR')).toMatchObject({ installed: false, installedCount: 0 });
      expect((await preview(theirs.appuser, 'pt-BR')).rules.every((rule) => rule.status === 'new')).toBe(true);
    });

    it('shares an installed preset with the other member of the household', async () => {
      await seedSystemCategories();
      const household = await seedHousehold(db.em());
      const partner = await addPartner(db.em(), household);

      const first = await install(household.appuser, 'en');
      const second = await install(partner, 'en');

      expect(second.created).toEqual([]);
      expect(second.skipped).toEqual(first.created);
      expect((await list(partner)).presets.find((preset) => preset.code === 'en')).toMatchObject({ installed: true });
    });
  });

  describe('the preset it suggests', () => {
    it('lists every preset with its rule count', async () => {
      const household = await seedHousehold(db.em());

      const { presets } = await list(household.appuser);

      expect(presets.map((preset) => [preset.code, preset.ruleCount])).toEqual(RULE_PRESETS.map((preset) => [preset.preset.code, preset.rules.length]));
    });

    it('follows the language and region the client sends', async () => {
      const household = await seedHousehold(db.em());

      expect((await list(household.appuser, '?language=pt')).suggested).toBe('pt-PT');
      expect((await list(household.appuser, '?language=pt&region=BR')).suggested).toBe('pt-BR');
      expect((await list(household.appuser, '?language=es')).suggested).toBe('es-ES');
      expect((await list(household.appuser, '?language=es-MX')).suggested).toBeNull();
    });

    it('falls back to the person\'s language and currency', async () => {
      const household = await seedHousehold(db.em());
      const em = db.em();
      const appuser = await em.findOneOrFail(Appuser, { appuserKey: household.appuser.appuserKey });
      appuser.language = SupportedLanguages.PT;
      appuser.currencyKey = await currencyFor(em, 'BRL');
      await em.flush();

      expect((await list(household.appuser)).suggested).toBe('pt-BR');
    });

    it('prefers the country the person banks in', async () => {
      const household = await seedHousehold(db.em());
      const em = db.em();
      const credential = em.create(EnableBankingCredential, { applicationId: 'app-1', appuserKey: household.appuser, encryptionKeyVersion: 1, privateKeyAuthTag: 'tag', privateKeyCiphertext: 'cipher', privateKeyIv: 'iv', tenantKey: household.tenant }, { partial: true });
      em.create(EnableBankingConnection, { appuserKey: household.appuser, aspspCountry: 'ES', aspspName: 'Bank', enableBankingCredentialKey: credential, sessionId: 'session-1', state: 'state-1', status: EnableBankingConnectionStatus.LINKED, tenantKey: household.tenant }, { partial: true });
      await em.flush();

      expect((await list(household.appuser, '?language=en&region=GB')).suggested).toBe('es-ES');
    });

    it('rejects a malformed language or region', async () => {
      const household = await seedHousehold(db.em());

      expect((await rules.as(household.appuser).get('/v1/rule/presets?language=portuguese')).status).toBe(400);
      expect((await rules.as(household.appuser).get('/v1/rule/presets?region=BRA')).status).toBe(400);
    });
  });
});
