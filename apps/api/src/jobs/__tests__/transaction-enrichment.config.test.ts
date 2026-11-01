import { describe, expect, it } from 'vitest';

import { buildTransactionEnrichmentConfig } from '@app/jobs/transaction-enrichment.config';

const FOUNDRY = {
  AZURE_AI_FOUNDRY_API_KEY: 'key',
  AZURE_AI_FOUNDRY_API_VERSION: '2024-05-01-preview',
  AZURE_AI_FOUNDRY_ENDPOINT: 'https://example.services.ai.azure.com',
};

describe('transaction enrichment config', () => {
  it('runs in write mode out of the box once a model provider is configured', () => {
    // The pipeline enriches and applies suggestions by default. Anything that
    // silently turned that off would look identical to the feature simply not working.
    const config = buildTransactionEnrichmentConfig(FOUNDRY);
    expect(config.enabled).toBe(true);
    expect(config.mode).toBe('write');
    expect(config.modelVersion).toBe('DeepSeek-V4-Flash');
    expect(config.writeConfidenceThreshold).toBe(0.7);
  });

  it('is off on a server with no model provider, so no job is enqueued to fail', () => {
    expect(buildTransactionEnrichmentConfig({}).enabled).toBe(false);
  });

  it('calls the OpenAI-compatible model by default when that is the provider', () => {
    const config = buildTransactionEnrichmentConfig({ AI_BASE_URL: 'http://localhost:11434/v1', AI_MODEL_ENRICHMENT: 'qwen2.5' });
    expect(config.enabled).toBe(true);
    expect(config.modelVersion).toBe('qwen2.5');
  });

  describe('operational controls that must stay overridable', () => {
    it('honours the emergency kill switch without a redeploy', () => {
      expect(buildTransactionEnrichmentConfig({ ...FOUNDRY, TRANSACTION_ENRICHMENT_GPT_ENABLED: 'false' }).enabled).toBe(false);
    });

    it('honours the per-tenant daily spend cap', () => {
      expect(buildTransactionEnrichmentConfig({ TRANSACTION_ENRICHMENT_GPT_DAILY_TENANT_BUDGET: '50' }).dailyTenantBudget).toBe(50);
    });

    it('lets the model be swapped, because the value is the model actually called', () => {
      // `deepseek.ts` passes this straight through as `model:` — it selects, it does not label.
      expect(buildTransactionEnrichmentConfig({ TRANSACTION_ENRICHMENT_GPT_MODEL_VERSION: 'gpt-5.4-nano' }).modelVersion).toBe('gpt-5.4-nano');
    });

    it('supports shadow mode for evaluating a change without writing', () => {
      expect(buildTransactionEnrichmentConfig({ TRANSACTION_ENRICHMENT_GPT_MODE: 'shadow' }).mode).toBe('shadow');
    });

    it('rejects a malformed override rather than silently falling back', () => {
      // A typo in an emergency kill switch must not resolve to "carry on".
      expect(() => buildTransactionEnrichmentConfig({ TRANSACTION_ENRICHMENT_GPT_ENABLED: 'nope' })).toThrow();
      expect(() => buildTransactionEnrichmentConfig({ TRANSACTION_ENRICHMENT_GPT_MODE: 'dry-run' })).toThrow();
    });
  });

  describe('knobs that are now constants', () => {
    it('ignores the retired queue-mechanic variables', () => {
      // These were env-readable, never set anywhere, and describe how pg-boss should treat
      // this queue — a property of the work, not of the deployment. Setting them now does
      // nothing, and this test is what says so out loud.
      const config = buildTransactionEnrichmentConfig({
        TRANSACTION_ENRICHMENT_GPT_EXPIRATION_SECONDS: '9999',
        TRANSACTION_ENRICHMENT_GPT_RETENTION_SECONDS: '1',
        TRANSACTION_ENRICHMENT_GPT_RETRY_DELAY_SECONDS: '9999',
        TRANSACTION_ENRICHMENT_GPT_RETRY_LIMIT: '99',
      });
      expect(config.expirationSeconds).toBe(300);
      expect(config.retentionSeconds).toBe(1_209_600);
      expect(config.retryDelaySeconds).toBe(60);
      expect(config.retryLimit).toBe(3);
    });

    it('will not let the environment mislabel which prompt produced a row', () => {
      // The prompt text is fixed in services/transaction-enrichment/prompt.ts and nothing
      // selects a prompt by version. An override would stamp rows produced by *this* prompt
      // with another version's name, corrupting the only record available for comparing
      // prompt performance.
      const config = buildTransactionEnrichmentConfig({ TRANSACTION_ENRICHMENT_GPT_PROMPT_VERSION: 'v2-that-does-not-exist' });
      expect(config.promptVersion).toBe('transaction-enrichment-v1');
    });
  });
});
