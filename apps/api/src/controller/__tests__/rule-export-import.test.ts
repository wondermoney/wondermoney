import { describe, expect, it, vi } from 'vitest';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('@service/auth/better-auth', async () => (await import('@app/__tests__/__helpers__/auth-session-double')).mockAuthSession());

import { addAccount, addCategory, addMerchant, addPartner, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { tenantHttp, useRequestContextEm } from '@app/__tests__/__helpers__/tenant-http';
import { Category } from '@entity/Category';
import { Rule } from '@entity/Rule';
import { Tag } from '@entity/Tag';
import ruleRoutes from '@route/rule';
import { MAX_IMPORT_RULES, RULE_EXPORT_FORMAT, RULE_EXPORT_VERSION, type RulesExportFile } from '@service/rules/rule-export.schema';
import { parseImportFile } from '@service/rules/rule-import.service';

/*
 * Moving a household's rules between instances: the export names what a rule refers to
 * (accounts, merchants, tags, system category keys, custom category names) instead of leaking
 * internal ids, and the import resolves those names against the target household. The dry run
 * is the promise that nothing is written before the person confirms what will happen.
 */
describe('rule export and import', () => {
  const db = useTestDatabase();
  useRequestContextEm(db);
  const rules = tenantHttp('/v1/rule', ruleRoutes, { jsonLimit: '2MB' });

  interface RuleDto { actions: unknown[]; active: boolean; conditions: unknown[]; match: string; name: string; ruleKey: number }

  const netflixRule = {
    actions: [{ type: 'hide' }],
    conditions: [{ field: 'merchant', operator: 'contains', value: 'netflix' }],
    name: 'Netflix',
  };

  async function addSystemCategory(name: string): Promise<Category> {
    const em = db.em();
    const category = em.create(Category, { bgColor: '#000', isSystemCategory: true, name, textColor: '#fff' }, { partial: true });
    await em.flush();
    return category;
  }

  async function addTag(household: Awaited<ReturnType<typeof seedHousehold>>, name: string): Promise<Tag> {
    const em = db.em();
    const tag = em.create(Tag, { color: '#94a3b8', name, tenantKey: household.tenant }, { partial: true });
    await em.flush();
    return tag;
  }

  async function createRule(user: Awaited<ReturnType<typeof seedHousehold>>['appuser'], body: Record<string, unknown>): Promise<RuleDto> {
    const response = await rules.as(user).post('/v1/rule').send(body);
    expect(response.status).toBe(201);
    return response.body.rule as RuleDto;
  }

  const exportAs = async (user: Awaited<ReturnType<typeof seedHousehold>>['appuser']): Promise<RulesExportFile> => {
    const response = await rules.as(user).get('/v1/rule/export');
    expect(response.status).toBe(200);
    expect(response.headers['content-disposition']).toContain('wondermoney-rules.json');
    return response.body as RulesExportFile;
  };

  const importAs = (user: Awaited<ReturnType<typeof seedHousehold>>['appuser'], file: unknown, body: Record<string, unknown> = {}) =>
    rules.as(user).post('/v1/rule/import').send({ file, ...body });

  const liveRules = () => db.em().find(Rule, { deletedAt: null }, { orderBy: { position: 'asc', ruleKey: 'asc' } });

  describe('export', () => {
    it('names what a rule refers to instead of leaking internal ids', async () => {
      const household = await seedHousehold(db.em());
      const category = await addCategory(db.em(), household, 'Streaming');
      const system = await addSystemCategory('ENTERTAINMENT');
      const merchant = await addMerchant(db.em(), household, 'Netflix');
      const tag = await addTag(household, 'Subscriptions');

      await createRule(household.appuser, {
        actions: [
          { categoryId: category.categoryKey, type: 'set_category' },
          { merchantId: merchant.transactionMerchantKey, type: 'set_merchant' },
          { tagIds: [tag.tagKey], type: 'add_tags' },
        ],
        conditions: [
          { field: 'account', operator: 'in', values: [household.account.accountKey] },
          { field: 'category', operator: 'in', values: [category.categoryKey, system.categoryKey] },
        ],
        name: 'Everything',
      });

      const file = await exportAs(household.appuser);

      expect(file).toMatchObject({ format: RULE_EXPORT_FORMAT, version: RULE_EXPORT_VERSION });
      expect(file.rules).toHaveLength(1);
      expect(file.rules[0]).toMatchObject({
        actions: [
          { category: { name: 'Streaming' }, type: 'set_category' },
          { merchant: 'Netflix', type: 'set_merchant' },
          { tags: ['Subscriptions'], type: 'add_tags' },
        ],
        conditions: [
          { field: 'account', operator: 'in', values: ['Current account'] },
          { field: 'category', operator: 'in', values: [{ name: 'Streaming' }, { system: 'ENTERTAINMENT' }] },
        ],
      });
      expect(JSON.stringify(file)).not.toContain('categoryId');
      expect(JSON.stringify(file)).not.toContain('accountKey');
    });

    it('does not include another household\'s rules', async () => {
      const ours = await seedHousehold(db.em());
      const neighbour = await seedHousehold(db.em());
      await createRule(ours.appuser, netflixRule);
      await createRule(neighbour.appuser, { ...netflixRule, name: 'Theirs' });

      const file = await exportAs(ours.appuser);

      expect(file.rules.map((rule) => rule.name)).toEqual(['Netflix']);
    });

    it('leaves out a rule that is switched off by hand only when it has nothing left to export', async () => {
      const household = await seedHousehold(db.em());
      await createRule(household.appuser, { ...netflixRule, active: false });

      const file = await exportAs(household.appuser);

      expect(file.rules[0]).toMatchObject({ active: false, name: 'Netflix' });
    });

    it('does not name the other member\'s private account', async () => {
      const household = await seedHousehold(db.em());
      const partner = await addPartner(db.em(), household);
      const privateAccount = await addAccount(db.em(), household, { isPrivate: true });
      await createRule(household.appuser, {
        actions: [{ type: 'hide' }],
        conditions: [
          { field: 'merchant', operator: 'contains', value: 'netflix' },
          { field: 'account', operator: 'in', values: [privateAccount.accountKey] },
        ],
        name: 'Private',
      });

      const file = await exportAs(partner);

      expect(file.rules[0]?.conditions).toEqual([{ field: 'merchant', operator: 'contains', value: 'netflix' }]);
      expect(JSON.stringify(file)).not.toContain(privateAccount.accountName ?? '');
    });
  });

  describe('round trip', () => {
    it('recreates equivalent rules in a new household', async () => {
      const source = await seedHousehold(db.em());
      const sourceCategory = await addCategory(db.em(), source, 'Streaming');
      const system = await addSystemCategory('ENTERTAINMENT');
      const sourceMerchant = await addMerchant(db.em(), source, 'Netflix');
      const sourceTag = await addTag(source, 'Subscriptions');

      await createRule(source.appuser, {
        actions: [
          { categoryId: sourceCategory.categoryKey, type: 'set_category' },
          { merchantId: sourceMerchant.transactionMerchantKey, type: 'set_merchant' },
          { tagIds: [sourceTag.tagKey], type: 'add_tags' },
        ],
        conditions: [
          { field: 'description', operator: 'contains', source: 'raw', value: 'NETFLIX' },
          { field: 'account', operator: 'in', values: [source.account.accountKey] },
          { field: 'category', operator: 'in', values: [sourceCategory.categoryKey, system.categoryKey] },
          { field: 'amount', max: 20, min: 5, operator: 'between' },
        ],
        match: 'any',
        name: 'Streaming',
        stopProcessing: true,
      });
      const exported = await exportAs(source.appuser);

      const target = await seedHousehold(db.em());
      await addCategory(db.em(), target, 'Streaming');
      await addMerchant(db.em(), target, 'Netflix');
      await addTag(target, 'Subscriptions');

      const imported = await importAs(target.appuser, exported, { dryRun: false });
      expect(imported.status).toBe(200);
      expect(imported.body).toMatchObject({ imported: 1, unresolved: [] });

      const reExported = await exportAs(target.appuser);
      expect(reExported.rules).toEqual(exported.rules);
    });
  });

  describe('dry run', () => {
    it('lists creations, duplicates and unresolved references without writing', async () => {
      const household = await seedHousehold(db.em());
      await createRule(household.appuser, netflixRule);
      const before = await db.em().count(Rule, {}, { filters: false });

      const file = {
        format: RULE_EXPORT_FORMAT,
        rules: [
          { ...netflixRule, name: 'Netflix' },
          { ...netflixRule, name: 'Spotify' },
          { actions: [{ category: { name: 'Missing category' }, type: 'set_category' }], conditions: [{ field: 'merchant', operator: 'contains', value: 'x' }], name: 'Missing category' },
          { actions: [{ type: 'hide' }], conditions: [{ field: 'merchant', operator: 'contains', value: 'x' }, { field: 'account', operator: 'in', values: ['Missing account'] }], name: 'Missing account' },
        ],
        version: RULE_EXPORT_VERSION,
      };

      const response = await importAs(household.appuser, file);

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        categoriesToCreate: ['Missing category'],
        creates: [
          { active: true, name: 'Spotify' },
          { active: false, name: 'Missing account' },
        ],
        dryRun: true,
        duplicates: [{ name: 'Netflix' }],
        imported: 0,
        mode: 'append',
        removed: 0,
        unresolved: [
          { kind: 'category', reference: 'Missing category', ruleName: 'Missing category' },
          { kind: 'account', reference: 'Missing account', ruleName: 'Missing account' },
        ],
      });
      expect(await db.em().count(Rule, {}, { filters: false })).toBe(before);
      expect(await db.em().count(Category, { name: 'Missing category' }, { filters: false })).toBe(0);
    });

    it('does not create the categories it would create', async () => {
      const household = await seedHousehold(db.em());
      const file = {
        format: RULE_EXPORT_FORMAT,
        rules: [{ actions: [{ category: { name: 'Brand new' }, type: 'set_category' }], conditions: [{ field: 'merchant', operator: 'contains', value: 'x' }], name: 'New' }],
        version: RULE_EXPORT_VERSION,
      };

      const response = await importAs(household.appuser, file, { createCategories: true });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ categoriesToCreate: ['Brand new'], creates: [{ active: true, name: 'New' }] });
      expect(await db.em().count(Category, { name: 'Brand new' }, { filters: false })).toBe(0);
    });
  });

  describe('importing', () => {
    it('creates the missing custom categories when confirmed', async () => {
      const household = await seedHousehold(db.em());
      const file = {
        format: RULE_EXPORT_FORMAT,
        rules: [{ actions: [{ category: { name: 'Brand new' }, type: 'set_category' }], conditions: [{ field: 'merchant', operator: 'contains', value: 'x' }], name: 'New' }],
        version: RULE_EXPORT_VERSION,
      };

      const response = await importAs(household.appuser, file, { createCategories: true, dryRun: false });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ imported: 1, unresolved: [] });
      const category = await db.em().findOneOrFail(Category, { name: 'Brand new', tenantKey: household.tenant });
      expect(category.isSystemCategory).toBe(false);
      const rule = await db.em().findOneOrFail(Rule, { deletedAt: null });
      expect(rule.actions).toEqual([{ categoryId: category.categoryKey, type: 'set_category' }]);
    });

    it('imports a rule with an unresolved account switched off, without that condition', async () => {
      const household = await seedHousehold(db.em());
      const file = {
        format: RULE_EXPORT_FORMAT,
        rules: [
          {
            actions: [{ type: 'hide' }],
            conditions: [
              { field: 'merchant', operator: 'contains', value: 'netflix' },
              { field: 'account', operator: 'in', values: ['Missing account'] },
            ],
            name: 'Netflix',
          },
        ],
        version: RULE_EXPORT_VERSION,
      };

      const response = await importAs(household.appuser, file, { dryRun: false });

      expect(response.status).toBe(200);
      const rule = await db.em().findOneOrFail(Rule, { deletedAt: null });
      expect(rule).toMatchObject({ active: false, name: 'Netflix' });
      expect(rule.conditions).toEqual([{ field: 'merchant', operator: 'contains', value: 'netflix' }]);
    });

    it('skips a rule naming a system category this instance does not have', async () => {
      const household = await seedHousehold(db.em());
      const file = {
        format: RULE_EXPORT_FORMAT,
        rules: [{ actions: [{ category: { system: 'NOPE' }, type: 'set_category' }], conditions: [{ field: 'merchant', operator: 'contains', value: 'x' }], name: 'Unknown' }],
        version: RULE_EXPORT_VERSION,
      };

      const response = await importAs(household.appuser, file, { dryRun: false });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        creates: [],
        imported: 0,
        unresolved: [{ kind: 'category', reference: 'system:NOPE', ruleName: 'Unknown' }],
      });
      expect(await db.em().count(Rule, {}, { filters: false })).toBe(0);
    });

    it('skips a rule naming a tag this household does not have', async () => {
      const household = await seedHousehold(db.em());
      const file = {
        format: RULE_EXPORT_FORMAT,
        rules: [{ actions: [{ tags: ['Missing tag'], type: 'add_tags' }], conditions: [{ field: 'merchant', operator: 'contains', value: 'x' }], name: 'Tagged' }],
        version: RULE_EXPORT_VERSION,
      };

      const response = await importAs(household.appuser, file, { dryRun: false });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        creates: [],
        imported: 0,
        unresolved: [{ kind: 'tag', reference: 'Missing tag', ruleName: 'Tagged' }],
      });
      expect(await db.em().count(Rule, {}, { filters: false })).toBe(0);
    });

    it('appends after the household\'s existing rules', async () => {
      const household = await seedHousehold(db.em());
      await createRule(household.appuser, netflixRule);
      const file = {
        format: RULE_EXPORT_FORMAT,
        rules: [{ actions: [{ type: 'hide' }], conditions: [{ field: 'merchant', operator: 'contains', value: 'spotify' }], name: 'Spotify' }],
        version: RULE_EXPORT_VERSION,
      };

      const response = await importAs(household.appuser, file, { dryRun: false });

      expect(response.status).toBe(200);
      expect((await liveRules()).map((rule) => rule.name)).toEqual(['Netflix', 'Spotify']);
    });

    it('does not let another household import into ours or export ours', async () => {
      const ours = await seedHousehold(db.em());
      const neighbour = await seedHousehold(db.em());
      await createRule(ours.appuser, netflixRule);
      const file = {
        format: RULE_EXPORT_FORMAT,
        rules: [{ actions: [{ type: 'hide' }], conditions: [{ field: 'merchant', operator: 'contains', value: 'theirs' }], name: 'Theirs' }],
        version: RULE_EXPORT_VERSION,
      };

      const response = await importAs(neighbour.appuser, file, { dryRun: false });

      expect(response.status).toBe(200);
      expect((await exportAs(ours.appuser)).rules.map((rule) => rule.name)).toEqual(['Netflix']);
      expect((await exportAs(neighbour.appuser)).rules.map((rule) => rule.name)).toEqual(['Theirs']);
    });
  });

  describe('replace mode', () => {
    const replacement = {
      format: RULE_EXPORT_FORMAT,
      rules: [{ actions: [{ type: 'hide' }], conditions: [{ field: 'merchant', operator: 'contains', value: 'spotify' }], name: 'Spotify' }],
      version: RULE_EXPORT_VERSION,
    };

    it('asks for confirmation and removes nothing without it', async () => {
      const household = await seedHousehold(db.em());
      await createRule(household.appuser, netflixRule);

      const response = await importAs(household.appuser, replacement, { dryRun: false, mode: 'replace' });

      expect(response.status).toBe(400);
      expect((await liveRules()).map((rule) => rule.name)).toEqual(['Netflix']);
    });

    it('removes the existing rules only after a successful validation', async () => {
      const household = await seedHousehold(db.em());
      await createRule(household.appuser, netflixRule);
      const invalid = {
        format: RULE_EXPORT_FORMAT,
        rules: [{ actions: [{ type: 'hide' }], conditions: [], name: 'Broken' }],
        version: RULE_EXPORT_VERSION,
      };

      const response = await importAs(household.appuser, invalid, { confirm: true, dryRun: false, mode: 'replace' });

      expect(response.status).toBe(400);
      expect((await liveRules()).map((rule) => rule.name)).toEqual(['Netflix']);
    });

    it('replaces the household\'s rules when confirmed', async () => {
      const household = await seedHousehold(db.em());
      await createRule(household.appuser, netflixRule);

      const response = await importAs(household.appuser, replacement, { confirm: true, dryRun: false, mode: 'replace' });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ imported: 1, mode: 'replace', removed: 1 });
      expect((await liveRules()).map((rule) => rule.name)).toEqual(['Spotify']);
    });

    it('does not treat an existing rule with the same name as a duplicate', async () => {
      const household = await seedHousehold(db.em());
      await createRule(household.appuser, netflixRule);
      const sameName = {
        format: RULE_EXPORT_FORMAT,
        rules: [{ actions: [{ type: 'hide' }], conditions: [{ field: 'merchant', operator: 'contains', value: 'other' }], name: 'Netflix' }],
        version: RULE_EXPORT_VERSION,
      };

      const response = await importAs(household.appuser, sameName, { confirm: true, dryRun: false, mode: 'replace' });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ duplicates: [], imported: 1 });
    });
  });

  describe('invalid files', () => {
    it('refuses a file that is not a rules export', async () => {
      const household = await seedHousehold(db.em());

      const response = await importAs(household.appuser, { format: 'something-else', rules: [], version: 1 });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('WonderMoney rules export');
    });

    it('refuses an unsupported version', async () => {
      const household = await seedHousehold(db.em());

      const response = await importAs(household.appuser, { format: RULE_EXPORT_FORMAT, rules: [], version: 2 });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('version');
    });

    it('refuses a rule that does not read as a rule', async () => {
      const household = await seedHousehold(db.em());
      const file = {
        format: RULE_EXPORT_FORMAT,
        rules: [{ actions: [], conditions: [], name: '' }],
        version: RULE_EXPORT_VERSION,
      };

      const response = await importAs(household.appuser, file, { dryRun: false });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('Invalid rules file');
      expect(await db.em().count(Rule, {}, { filters: false })).toBe(0);
    });

    it('refuses more than the allowed number of rules', async () => {
      const household = await seedHousehold(db.em());
      const rule = { actions: [{ type: 'hide' }], conditions: [{ field: 'merchant', operator: 'contains', value: 'x' }], name: 'Rule' };
      const file = { format: RULE_EXPORT_FORMAT, rules: Array.from({ length: MAX_IMPORT_RULES + 1 }, () => rule), version: RULE_EXPORT_VERSION };

      const response = await importAs(household.appuser, file);

      expect(response.status).toBe(400);
      expect(response.body.message).toContain(String(MAX_IMPORT_RULES));
    });

    it('refuses a file over 1 MB before parsing it', () => {
      const file = { format: RULE_EXPORT_FORMAT, padding: 'x'.repeat(1024 * 1024 + 1), rules: [], version: RULE_EXPORT_VERSION };

      expect(() => parseImportFile(file)).toThrow(/larger than 1 MB/);
    });

    it('refuses a file over 1 MB at the endpoint', async () => {
      const household = await seedHousehold(db.em());
      const file = { format: RULE_EXPORT_FORMAT, padding: 'x'.repeat(1024 * 1024 + 1), rules: [], version: RULE_EXPORT_VERSION };

      const response = await importAs(household.appuser, file);

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('1 MB');
    });

    it('refuses a string that is not JSON', () => {
      expect(() => parseImportFile('not json')).toThrow(/not valid JSON/);
    });
  });

  describe('capacity', () => {
    it('refuses an import that would take the household over its rule limit', async () => {
      const household = await seedHousehold(db.em());
      const file = {
        format: RULE_EXPORT_FORMAT,
        rules: Array.from({ length: 201 }, (_, index) => ({
          actions: [{ type: 'hide' }],
          conditions: [{ field: 'merchant', operator: 'contains', value: `merchant-${index}` }],
          name: `Rule ${index}`,
        })),
        version: RULE_EXPORT_VERSION,
      };

      const response = await importAs(household.appuser, file, { dryRun: false });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('at most 200 rules');
      expect(await db.em().count(Rule, {}, { filters: false })).toBe(0);
    });
  });
});
