import { createHash } from 'node:crypto';

import { z } from 'zod';

/* eslint-disable perfectionist/sort-modules, perfectionist/sort-union-types */

const BANK_SYNC_CONTRACT_VERSION = 'bank-sync.v1' as const;
export const BANK_SYNC_EVENT_NAME = 'bank_sync_completed' as const;

export const bankSyncEnvironmentSchema = z.enum(['production', 'staging', 'development']);
export const bankSyncProducerSchema = z.enum(['pgboss-initial', 'pgboss-scheduled']);
export const bankSyncFlowSchema = z.enum(['initial-add', 'scheduled-refresh']);
export const bankSyncResultSchema = z.enum(['full_success', 'partial', 'failed']);

const canonicalUuidSchema = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
const safeDimensionSchema = z.string().min(1).max(128).regex(/^[\w.:/-]+$/);
const errorCategorySchema = z.enum(['authentication', 'cancelled', 'consent', 'data_validation', 'internal', 'provider', 'queue', 'timeout', 'unknown']);
const errorCodeSchema = z.enum(['account_phase_failed', 'authentication', 'cancelled', 'consent_expired', 'data_validation', 'institution_unavailable', 'internal', 'invalid_requisition', 'provider_unavailable', 'queue_unavailable', 'rate_limited', 'timeout', 'transaction_phase_failed', 'unknown']);

const bankSyncEventSchema = z.object({
  account_count: z.number().int().nonnegative().optional(),
  attempt: z.number().int().positive(),
  contract_version: z.literal(BANK_SYNC_CONTRACT_VERSION),
  distinct_id: canonicalUuidSchema,
  environment: bankSyncEnvironmentSchema,
  error_category: errorCategorySchema.optional(),
  error_code: errorCodeSchema.optional(),
  event_id: z.string().regex(/^bank-sync\.v1:[a-f0-9]{64}$/),
  final: z.boolean(),
  flow: bankSyncFlowSchema,
  incident_id: canonicalUuidSchema,
  institution_id: safeDimensionSchema.optional(),
  producer: bankSyncProducerSchema,
  requisition_context: z.string().regex(/^reqctx\.v1:[a-f0-9]{64}$/),
  result: bankSyncResultSchema,
}).strict().superRefine((event, context) => {
  const expectedFlow = event.producer === 'pgboss-initial' ? 'initial-add' : 'scheduled-refresh';
  if (event.flow !== expectedFlow) {
    context.addIssue({ code: 'custom', message: 'Bank sync producer does not match flow' });
  }
  if (event.result === 'full_success' && !event.final) {
    context.addIssue({ code: 'custom', message: 'Full success must be final' });
  }
  if (event.result !== 'full_success' && (!event.error_category || !event.error_code)) {
    context.addIssue({ code: 'custom', message: 'Failed and partial bank syncs require normalized error dimensions' });
  }
  if (event.result === 'full_success' && (event.error_category || event.error_code)) {
    context.addIssue({ code: 'custom', message: 'Successful bank syncs cannot contain error dimensions' });
  }
  const expectedId = deterministicBankSyncEventId(event);
  if (event.event_id !== expectedId) {
    context.addIssue({ code: 'custom', message: 'Bank sync event id is not deterministic' });
  }
});

export type BankSyncEnvironment = z.infer<typeof bankSyncEnvironmentSchema>;
export type BankSyncProducer = z.infer<typeof bankSyncProducerSchema>;
export type BankSyncFlow = z.infer<typeof bankSyncFlowSchema>;
export type BankSyncContractResult = z.infer<typeof bankSyncResultSchema>;
export type BankSyncEvent = z.infer<typeof bankSyncEventSchema>;
export type BankSyncEventInput = Omit<BankSyncEvent, 'contract_version' | 'event_id'>;

function deterministicBankSyncEventId(
  input: Pick<BankSyncEvent, 'incident_id' | 'producer' | 'attempt' | 'result'>,
): string {
  const material = [BANK_SYNC_CONTRACT_VERSION, input.incident_id, input.producer, input.attempt, input.result].join(':');
  return `${BANK_SYNC_CONTRACT_VERSION}:${createHash('sha256').update(material).digest('hex')}`;
}

export function deterministicRequisitionContext(requisitionId: string): string {
  return `reqctx.v1:${createHash('sha256').update(`bank-sync-requisition.v1:${requisitionId}`).digest('hex')}`;
}

export function buildBankSyncEvent(input: BankSyncEventInput): BankSyncEvent {
  return parseBankSyncEvent({
    ...input,
    contract_version: BANK_SYNC_CONTRACT_VERSION,
    event_id: deterministicBankSyncEventId(input),
  });
}

export function parseBankSyncEvent(input: unknown): BankSyncEvent {
  return bankSyncEventSchema.parse(input);
}

const NORMALIZED_ERRORS: Readonly<Record<string, Readonly<{ error_category: string; error_code: string }>>> = {
  aborted: { error_category: 'cancelled', error_code: 'cancelled' },
  account_phase_failed: { error_category: 'provider', error_code: 'account_phase_failed' },
  authentication: { error_category: 'authentication', error_code: 'authentication' },
  consent_expired: { error_category: 'consent', error_code: 'consent_expired' },
  data_validation: { error_category: 'data_validation', error_code: 'data_validation' },
  etimedout: { error_category: 'timeout', error_code: 'timeout' },
  institution_unavailable: { error_category: 'provider', error_code: 'institution_unavailable' },
  internal: { error_category: 'internal', error_code: 'internal' },
  invalid_requisition: { error_category: 'data_validation', error_code: 'invalid_requisition' },
  provider_unavailable: { error_category: 'provider', error_code: 'provider_unavailable' },
  queue_unavailable: { error_category: 'queue', error_code: 'queue_unavailable' },
  rate_limited: { error_category: 'provider', error_code: 'rate_limited' },
  timeout: { error_category: 'timeout', error_code: 'timeout' },
  transaction_phase_failed: { error_category: 'provider', error_code: 'transaction_phase_failed' },
};

export function normalizeBankSyncError(input: Readonly<{ category?: string; code?: string }>): {
  error_category: NonNullable<BankSyncEvent['error_category']>;
  error_code: NonNullable<BankSyncEvent['error_code']>;
} {
  for (const candidate of [input.code, input.category]) {
    if (!candidate) continue;
    const normalized = NORMALIZED_ERRORS[candidate.trim().toLowerCase()];
    if (normalized) return { ...normalized } as ReturnType<typeof normalizeBankSyncError>;
  }
  return { error_category: 'unknown', error_code: 'unknown' };
}

/* eslint-enable perfectionist/sort-modules, perfectionist/sort-union-types */
