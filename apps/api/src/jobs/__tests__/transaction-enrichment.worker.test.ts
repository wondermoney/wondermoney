import { beforeEach, describe, expect, it, vi } from 'vitest';

const { find, findOne, flush, getReference, persist } = vi.hoisted(() => ({
  find: vi.fn(),
  findOne: vi.fn(),
  flush: vi.fn().mockResolvedValue(undefined),
  getReference: vi.fn((_entity: unknown, key: unknown) => ({ __ref: key })),
  persist: vi.fn(),
}));
vi.mock('@app/database/di', () => ({ DI: { em: { find, findOne, flush, getReference, persist } } }));

import { handleTransactionEnrichmentGptJob } from '@app/jobs/transaction-enrichment.worker';
import { CategorizationConfidence } from '@entity/Transaction';
import { TransactionEnrichmentStatus } from '@entity/TransactionEnrichment';
import { DeepSeekHttpError } from '@service/ai/deepseek';

import { pgBossJob } from '../../__tests__/__helpers__/pgboss-job';

const shadowConfig = {
  dailyTenantBudget: 50,
  enabled: true,
  expirationSeconds: 300,
  mode: 'shadow' as const,
  modelVersion: 'DeepSeek-V4-Flash',
  promptVersion: 'transaction-enrichment-v1',
  retentionSeconds: 1209600,
  retryDelaySeconds: 60,
  retryLimit: 3,
  writeConfidenceThreshold: 0.7,
};
const offConfig = { ...shadowConfig, enabled: false, mode: 'off' as const };
const writeConfig = { ...shadowConfig, mode: 'write' as const };

const validPayload = {
  correlationId: 'corr-1',
  idempotencyKey: 'idem-1',
  modelVersion: 'DeepSeek-V4-Flash',
  promptVersion: 'transaction-enrichment-v1',
  transactionEnrichmentKey: 55,
};

const job = (data: unknown, id = 'job-1') => pgBossJob(data, { id }) as Parameters<typeof handleTransactionEnrichmentGptJob>[0];

function enrichmentRow(overrides: Record<string, unknown> = {}) {
  return {
    attemptCount: 0,
    idempotencyKey: 'idem-1',
    inputHash: '',
    modelVersion: 'DeepSeek-V4-Flash',
    promptVersion: 'transaction-enrichment-v1',
    status: TransactionEnrichmentStatus.PENDING,
    tenantKey: { tenantKey: 7 },
    transactionEnrichmentKey: 55,
    transactionKey: { transactionKey: 900 },
    ...overrides,
  };
}

/**
 * The category the model suggested, resolved by the worker before it applies
 * anything so it can refuse to write the uninformative system `OTHER`.
 * Defaults to an ordinary, applicable category.
 */
function suggestedCategory(overrides: Record<string, unknown> = {}) {
  return { categoryKey: 12, isSystemCategory: true, name: 'GROCERIES', ...overrides };
}

function transactionRow(overrides: Record<string, unknown> = {}) {
  return {
    accountKey: { accountOwnerAppuserKey: { appuserKey: 1 } },
    categorizationConfidence: CategorizationConfidence.NONE,
    description: 'ACME STORE 123',
    reviewed: false,
    settlementAmount: -20,
    transactionKey: 900,
    transactionMerchantKey: { name: 'ACME STORE' },
    ...overrides,
  };
}

const successResult = {
  inputHash: 'a'.repeat(64),
  inputId: 'a'.repeat(64),
  modelVersion: 'DeepSeek-V4-Flash',
  promptVersion: 'transaction-enrichment-v1',
  result: { categorySuggestionKey: 12, confidence: 0.87, inputId: 'a'.repeat(64), merchantSuggestion: 'Acme', reasonCode: 'merchant_and_category_suggested' },
  tokens: { completionTokens: 40, promptTokens: 120, totalTokens: 160 },
};

const logger = { info: vi.fn(), warn: vi.fn() };

beforeEach(() => {
  find.mockReset();
  findOne.mockReset();
  flush.mockReset().mockResolvedValue(undefined);
  persist.mockReset();
  getReference.mockReset().mockImplementation((_entity: unknown, key: unknown) => ({ __ref: key }));
  logger.info.mockReset();
  logger.warn.mockReset();
});

describe('handleTransactionEnrichmentGptJob', () => {
  it('returns false on an invalid payload without touching the model', async () => {
    const requestSuggestion = vi.fn();
    const result = await handleTransactionEnrichmentGptJob(job({ nope: true }), { config: shadowConfig, logger, requestSuggestion });
    expect(result).toBe(false);
    expect(requestSuggestion).not.toHaveBeenCalled();
    expect(findOne).not.toHaveBeenCalled();
  });

  it('is a no-op that consumes the job when the pipeline is off', async () => {
    const requestSuggestion = vi.fn();
    const result = await handleTransactionEnrichmentGptJob(job(validPayload), { config: offConfig, logger, requestSuggestion });
    expect(result).toBe(true);
    expect(requestSuggestion).not.toHaveBeenCalled();
    expect(findOne).not.toHaveBeenCalled();
  });

  it('returns false when the enrichment row is missing', async () => {
    findOne.mockResolvedValueOnce(null);
    const result = await handleTransactionEnrichmentGptJob(job(validPayload), { config: shadowConfig, logger, requestSuggestion: vi.fn() });
    expect(result).toBe(false);
  });

  it('is an idempotent no-op when the row is already terminal', async () => {
    findOne.mockResolvedValueOnce(enrichmentRow({ status: TransactionEnrichmentStatus.SHADOW }));
    const requestSuggestion = vi.fn();
    const result = await handleTransactionEnrichmentGptJob(job(validPayload), { config: shadowConfig, logger, requestSuggestion });
    expect(result).toBe(true);
    expect(requestSuggestion).not.toHaveBeenCalled();
  });

  it('skips with budget_exhausted and does not call the model when the budget is spent', async () => {
    const row = enrichmentRow();
    findOne.mockResolvedValueOnce(row).mockResolvedValueOnce(transactionRow());
    find.mockResolvedValueOnce([]).mockResolvedValueOnce([{ categoryKey: 12, name: 'Groceries' }]);
    const requestSuggestion = vi.fn();
    const reserveBudget = vi.fn().mockResolvedValue(false);

    const result = await handleTransactionEnrichmentGptJob(job(validPayload), { config: shadowConfig, logger, requestSuggestion, reserveBudget });

    expect(result).toBe(true);
    expect(requestSuggestion).not.toHaveBeenCalled();
    expect(row.status).toBe(TransactionEnrichmentStatus.SKIPPED);
    expect((row as { eligibilityReason?: string }).eligibilityReason).toBe('budget_exhausted');
    expect(reserveBudget).toHaveBeenCalledWith(expect.anything(), 7, expect.any(String), 50);
  });

  it('records a SHADOW suggestion on success and leaves the transaction untouched', async () => {
    const row = enrichmentRow();
    const transaction = transactionRow();
    findOne.mockResolvedValueOnce(row).mockResolvedValueOnce(transaction);
    find.mockResolvedValueOnce([]).mockResolvedValueOnce([{ categoryKey: 12, name: 'Groceries' }]);
    const requestSuggestion = vi.fn().mockResolvedValue(successResult);
    const reserveBudget = vi.fn().mockResolvedValue(true);

    const result = await handleTransactionEnrichmentGptJob(job(validPayload), { config: shadowConfig, logger, requestSuggestion, reserveBudget });

    expect(result).toBe(true);
    expect(row.status).toBe(TransactionEnrichmentStatus.SHADOW);
    expect((row as { promptTokens?: number }).promptTokens).toBe(120);
    expect((row as { completionTokens?: number }).completionTokens).toBe(40);
    expect((row as { totalTokens?: number }).totalTokens).toBe(160);
    expect((row as { estimatedCostUsd?: number }).estimatedCostUsd).toBeGreaterThan(0);
    expect((row as { confidence?: number }).confidence).toBe(0.87);
    expect((row as { merchantSuggestion?: string }).merchantSuggestion).toBe('Acme');
    expect((row as { reasonCode?: string }).reasonCode).toBe('merchant_and_category_suggested');
    expect((row as { inputHash?: string }).inputHash).toBe('a'.repeat(64));
    expect((row as { completedAt?: Date }).completedAt).toBeInstanceOf(Date);
    // apply-nothing: the transaction's categorization is not mutated in shadow mode.
    expect(transaction.categorizationConfidence).toBe(CategorizationConfidence.NONE);
  });

  it('applies a confident suggestion in write mode: categorizes the transaction, marks it ai_suggested, keeps it in review', async () => {
    const row = enrichmentRow();
    const transaction = transactionRow();
    // enrichment row, transaction, the suggested category, then the
    // "already categorized?" lookup (none)
    findOne
      .mockResolvedValueOnce(row)
      .mockResolvedValueOnce(transaction)
      .mockResolvedValueOnce(suggestedCategory())
      .mockResolvedValueOnce(null);
    find.mockResolvedValueOnce([]).mockResolvedValueOnce([{ categoryKey: 12, name: 'Groceries' }]);
    const requestSuggestion = vi.fn().mockResolvedValue(successResult);
    const reserveBudget = vi.fn().mockResolvedValue(true);

    const result = await handleTransactionEnrichmentGptJob(job(validPayload), { config: writeConfig, logger, requestSuggestion, reserveBudget });

    expect(result).toBe(true);
    expect(row.status).toBe(TransactionEnrichmentStatus.COMPLETED);
    // The category assignment was persisted from the AI source.
    expect(persist).toHaveBeenCalledTimes(1);
    expect(persist.mock.calls[0]![0]).toMatchObject({ source: 'openai' });
    // The transaction is applied but stays in the review queue as an AI suggestion for the user to confirm.
    expect(transaction.categorizationConfidence).toBe(CategorizationConfidence.MEDIUM);
    expect((transaction as { categorizationReason?: string }).categorizationReason).toBe('ai_suggested');
    expect(transaction.reviewed).toBe(false);
  });

  it('records SHADOW (does not apply) when the model confidence is below the write threshold', async () => {
    const row = enrichmentRow();
    const transaction = transactionRow();
    findOne.mockResolvedValueOnce(row).mockResolvedValueOnce(transaction);
    find.mockResolvedValueOnce([]).mockResolvedValueOnce([{ categoryKey: 12, name: 'Groceries' }]);
    const lowConfidence = { ...successResult, result: { ...successResult.result, confidence: 0.5 } };
    const requestSuggestion = vi.fn().mockResolvedValue(lowConfidence);
    const reserveBudget = vi.fn().mockResolvedValue(true);

    const result = await handleTransactionEnrichmentGptJob(job(validPayload), { config: writeConfig, logger, requestSuggestion, reserveBudget });

    expect(result).toBe(true);
    expect(row.status).toBe(TransactionEnrichmentStatus.SHADOW);
    expect(persist).not.toHaveBeenCalled();
    expect(transaction.categorizationConfidence).toBe(CategorizationConfidence.NONE);
  });

  it('does not overwrite an existing category: records SHADOW when the transaction is already categorized', async () => {
    const row = enrichmentRow();
    const transaction = transactionRow();
    // third findOne resolves the suggested category, fourth is the existing
    // assignment lookup → a row here means already categorized
    findOne
      .mockResolvedValueOnce(row)
      .mockResolvedValueOnce(transaction)
      .mockResolvedValueOnce(suggestedCategory())
      .mockResolvedValueOnce({ appuserTransactionCategoryKey: 1 });
    find.mockResolvedValueOnce([]).mockResolvedValueOnce([{ categoryKey: 12, name: 'Groceries' }]);
    const requestSuggestion = vi.fn().mockResolvedValue(successResult);
    const reserveBudget = vi.fn().mockResolvedValue(true);

    const result = await handleTransactionEnrichmentGptJob(job(validPayload), { config: writeConfig, logger, requestSuggestion, reserveBudget });

    expect(result).toBe(true);
    expect(row.status).toBe(TransactionEnrichmentStatus.SHADOW);
    expect(persist).not.toHaveBeenCalled();
    expect(transaction.categorizationConfidence).toBe(CategorizationConfidence.NONE);
  });

  // `OTHER` is the model's most common suggestion by far. It conveys nothing and marks
  // the transaction categorised, so it drops off the needs-attention surfaces. Never write it.
  it('never applies the OTHER system category, even above the write threshold', async () => {
    const row = enrichmentRow();
    const transaction = transactionRow();
    findOne
      .mockResolvedValueOnce(row)
      .mockResolvedValueOnce(transaction)
      .mockResolvedValueOnce({ categoryKey: 6, isSystemCategory: true, name: 'OTHER' });
    find.mockResolvedValueOnce([]).mockResolvedValueOnce([{ categoryKey: 6, name: 'OTHER' }]);
    const requestSuggestion = vi.fn().mockResolvedValue(successResult);
    const reserveBudget = vi.fn().mockResolvedValue(true);

    const result = await handleTransactionEnrichmentGptJob(job(validPayload), { config: writeConfig, logger, requestSuggestion, reserveBudget });

    expect(result).toBe(true);
    expect(row.status).toBe(TransactionEnrichmentStatus.SHADOW);
    expect(persist).not.toHaveBeenCalled();
    expect(transaction.categorizationConfidence).toBe(CategorizationConfidence.NONE);
  });

  // A tenant-owned category a user happens to have named "OTHER" is their own
  // choice and stays applicable — only the system category is suppressed.
  it('still applies a tenant category named OTHER, since only the system one is uninformative', async () => {
    const row = enrichmentRow();
    const transaction = transactionRow();
    findOne
      .mockResolvedValueOnce(row)
      .mockResolvedValueOnce(transaction)
      .mockResolvedValueOnce({ categoryKey: 91, isSystemCategory: false, name: 'OTHER' })
      .mockResolvedValueOnce(null);
    find.mockResolvedValueOnce([]).mockResolvedValueOnce([{ categoryKey: 91, name: 'OTHER' }]);
    const requestSuggestion = vi.fn().mockResolvedValue(successResult);
    const reserveBudget = vi.fn().mockResolvedValue(true);

    const result = await handleTransactionEnrichmentGptJob(job(validPayload), { config: writeConfig, logger, requestSuggestion, reserveBudget });

    expect(result).toBe(true);
    expect(row.status).toBe(TransactionEnrichmentStatus.COMPLETED);
    expect(persist).toHaveBeenCalled();
  });

  it.each([429, 500, 503])('throws to trigger a pg-boss retry on transport status %i', async (status) => {
    const row = enrichmentRow();
    findOne.mockResolvedValueOnce(row).mockResolvedValueOnce(transactionRow());
    find.mockResolvedValueOnce([]).mockResolvedValueOnce([{ categoryKey: 12, name: 'Groceries' }]);
    const requestSuggestion = vi.fn().mockRejectedValue(new DeepSeekHttpError(status));
    const reserveBudget = vi.fn().mockResolvedValue(true);

    await expect(
      handleTransactionEnrichmentGptJob(job(validPayload), { config: shadowConfig, logger, requestSuggestion, reserveBudget }),
    ).rejects.toThrow();
    expect(row.status).not.toBe(TransactionEnrichmentStatus.FAILED);
  });

  it('marks FAILED without throwing on a terminal 4xx transport error', async () => {
    const row = enrichmentRow();
    findOne.mockResolvedValueOnce(row).mockResolvedValueOnce(transactionRow());
    find.mockResolvedValueOnce([]).mockResolvedValueOnce([{ categoryKey: 12, name: 'Groceries' }]);
    const requestSuggestion = vi.fn().mockRejectedValue(new DeepSeekHttpError(400));
    const reserveBudget = vi.fn().mockResolvedValue(true);

    const result = await handleTransactionEnrichmentGptJob(job(validPayload), { config: shadowConfig, logger, requestSuggestion, reserveBudget });

    expect(result).toBe(true);
    expect(row.status).toBe(TransactionEnrichmentStatus.FAILED);
    expect((row as { errorCode?: string }).errorCode).toEqual(expect.any(String));
  });

  it('does NOT retry a deterministic DB error: marks FAILED, returns, never re-reserves budget or calls the model', async () => {
    const row = enrichmentRow();
    findOne.mockResolvedValueOnce(row).mockResolvedValueOnce(transactionRow());
    find.mockRejectedValueOnce(new Error('db down: SELECT ... category'));
    const requestSuggestion = vi.fn();
    const reserveBudget = vi.fn().mockResolvedValue(true);

    const result = await handleTransactionEnrichmentGptJob(job(validPayload), { config: shadowConfig, logger, requestSuggestion, reserveBudget });

    expect(result).toBe(true);
    expect(row.status).toBe(TransactionEnrichmentStatus.FAILED);
    expect(reserveBudget).not.toHaveBeenCalled();
    expect(requestSuggestion).not.toHaveBeenCalled();
  });

  it('marks FAILED without throwing on a validation/parse error', async () => {
    const row = enrichmentRow();
    findOne.mockResolvedValueOnce(row).mockResolvedValueOnce(transactionRow());
    find.mockResolvedValueOnce([]).mockResolvedValueOnce([{ categoryKey: 12, name: 'Groceries' }]);
    const requestSuggestion = vi.fn().mockRejectedValue(new Error('transaction enrichment invalid response'));
    const reserveBudget = vi.fn().mockResolvedValue(true);

    const result = await handleTransactionEnrichmentGptJob(job(validPayload), { config: shadowConfig, logger, requestSuggestion, reserveBudget });

    expect(result).toBe(true);
    expect(row.status).toBe(TransactionEnrichmentStatus.FAILED);
  });

  it('never logs raw description/merchant text or the model response', async () => {
    const row = enrichmentRow();
    findOne.mockResolvedValueOnce(row).mockResolvedValueOnce(transactionRow({ description: 'SECRET-IBAN-DESC' }));
    find.mockResolvedValueOnce([]).mockResolvedValueOnce([{ categoryKey: 12, name: 'Groceries' }]);
    const requestSuggestion = vi.fn().mockResolvedValue(successResult);
    const reserveBudget = vi.fn().mockResolvedValue(true);

    await handleTransactionEnrichmentGptJob(job(validPayload), { config: shadowConfig, logger, requestSuggestion, reserveBudget });

    const logged = JSON.stringify([...logger.info.mock.calls, ...logger.warn.mock.calls]);
    expect(logged).not.toContain('SECRET-IBAN-DESC');
    expect(logged).not.toContain('ACME STORE');
  });

  describe('candidate category personalization', () => {
    it("ranks candidates by the user's own correction-vote counts when enough personal history exists", async () => {
      const row = enrichmentRow();
      const transaction = transactionRow();
      findOne.mockResolvedValueOnce(row).mockResolvedValueOnce(transaction);
      find.mockResolvedValueOnce([
        { categoryKey: { categoryKey: 5, name: 'Rent' }, count: 2 },
        { categoryKey: { categoryKey: 12, name: 'Groceries' }, count: 9 },
        { categoryKey: { categoryKey: 12, name: 'Groceries' }, count: 1 }, // second merchant, same category: totals sum
        { categoryKey: { categoryKey: 30, name: 'Transport' }, count: 4 },
      ]);
      const requestSuggestion = vi.fn().mockResolvedValue(successResult);
      const reserveBudget = vi.fn().mockResolvedValue(true);

      await handleTransactionEnrichmentGptJob(job(validPayload), { config: shadowConfig, logger, requestSuggestion, reserveBudget });

      // Only ONE find() call: the personalized stats lookup. No fallback query to the full category list.
      expect(find).toHaveBeenCalledTimes(1);
      const suggestionArgs = requestSuggestion.mock.calls[0]![0] as { categories: { categoryKey: number; label: string }[] };
      expect(suggestionArgs.categories).toEqual([
        { categoryKey: 12, label: 'Groceries' }, // 9 + 1 = 10, highest
        { categoryKey: 30, label: 'Transport' }, // 4
        { categoryKey: 5, label: 'Rent' }, // 2
      ]);
    });

    it('falls back to the full tenant + system category list when the user has too little correction history', async () => {
      const row = enrichmentRow();
      const transaction = transactionRow();
      findOne.mockResolvedValueOnce(row).mockResolvedValueOnce(transaction);
      find
        .mockResolvedValueOnce([{ categoryKey: { categoryKey: 5, name: 'Rent' }, count: 1 }]) // below the personalization floor
        .mockResolvedValueOnce([
          { categoryKey: 12, name: 'Groceries' },
          { categoryKey: 5, name: 'Rent' },
        ]);
      const requestSuggestion = vi.fn().mockResolvedValue(successResult);
      const reserveBudget = vi.fn().mockResolvedValue(true);

      await handleTransactionEnrichmentGptJob(job(validPayload), { config: shadowConfig, logger, requestSuggestion, reserveBudget });

      expect(find).toHaveBeenCalledTimes(2);
      const suggestionArgs = requestSuggestion.mock.calls[0]![0] as { categories: { categoryKey: number; label: string }[] };
      expect(suggestionArgs.categories).toEqual([
        { categoryKey: 12, label: 'Groceries' },
        { categoryKey: 5, label: 'Rent' },
      ]);
    });

    it('falls back to the full category list when the transaction has no resolvable account owner', async () => {
      const row = enrichmentRow();
      const transaction = transactionRow({ accountKey: undefined });
      findOne.mockResolvedValueOnce(row).mockResolvedValueOnce(transaction);
      find.mockResolvedValueOnce([{ categoryKey: 12, name: 'Groceries' }]);
      const requestSuggestion = vi.fn().mockResolvedValue(successResult);
      const reserveBudget = vi.fn().mockResolvedValue(true);

      await handleTransactionEnrichmentGptJob(job(validPayload), { config: shadowConfig, logger, requestSuggestion, reserveBudget });

      // No owner to personalize for: skips the personalized lookup entirely, goes straight to the full list.
      expect(find).toHaveBeenCalledTimes(1);
    });
  });
});
