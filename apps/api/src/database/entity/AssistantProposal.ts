import type { Rel } from '@mikro-orm/core';
import { Entity, Enum, Filter, Index, ManyToOne, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';

import { ownerScopedCond, TENANT_FILTER } from '../filters/tenant-filter';

import { ApiToken } from './ApiToken';
import { Appuser } from './Appuser';
import { Base } from './BaseEntity';
import { Tenant } from './Tenant';

/** What a proposal would change. Each kind has its own payload schema (`assistant-proposal-payload.ts`). */
export enum AssistantProposalKind {
  CATEGORIZE_TRANSACTIONS = 'categorize_transactions',
  MARK_TRANSACTIONS_REVIEWED = 'mark_transactions_reviewed',
  UPDATE_TRANSACTION_NOTE = 'update_transaction_note',
}

/** Who drafted it: the in-app assistant, or an external MCP client holding an `mcp:propose` token. */
export enum AssistantProposalSource {
  ASSISTANT = 'assistant',
  MCP = 'mcp',
}

export enum AssistantProposalStatus {
  APPLIED = 'applied',
  EXPIRED = 'expired',
  /** It could no longer be applied: a transaction or the category was gone or out of sight. */
  FAILED = 'failed',
  PENDING = 'pending',
  REJECTED = 'rejected',
}

/**
 * A change the assistant or an MCP client asked for, waiting for the person to confirm it.
 *
 * Writing a proposal never touches a domain table: the `propose_*` tools only insert this row.
 * The change happens when the member who owns it applies it (`POST
 * /v1/assistant/proposals/:id/apply`), through the same services the ordinary endpoints use. A
 * pending proposal lapses after seven days (`expiresAt`, the daily expiry job).
 *
 * Owner-scoped: only the member it was drafted for sees it, not their partner.
 */
@Entity({ tableName: 'assistant_proposal' })
@Filter({ args: false, cond: ownerScopedCond, default: true, name: TENANT_FILTER })
@Index({ name: 'assistant_proposal_owner_status_created_idx', properties: ['tenantKey', 'appuserKey', 'status', 'createdAt'] })
@Index({ name: 'assistant_proposal_status_expires_at_idx', properties: ['status', 'expiresAt'] })
export class AssistantProposal extends Base {
  @ManyToOne({ cascade: [], entity: () => Appuser, fieldName: 'appuser_key' })
  appuserKey!: Rel<Appuser>;

  @PrimaryKey()
  assistantProposalKey!: number;

  /** The token an MCP client drafted it with; null for the in-app assistant. */
  @ManyToOne({ cascade: [], entity: () => ApiToken, fieldName: 'api_token_key', nullable: true })
  apiTokenKey?: Rel<ApiToken>;

  @Property({ columnType: 'timestamptz', nullable: true })
  decidedAt?: Date;

  @Property({ columnType: 'timestamptz' })
  expiresAt!: Date;

  /** Why an apply failed (`transaction_unavailable`, `category_unavailable`); null otherwise. */
  @Property({ length: 64, nullable: true })
  failureReason?: string;

  @Enum(() => AssistantProposalKind)
  kind!: AssistantProposalKind;

  /** The change itself, validated by the kind's zod schema on write and again on apply. */
  @Property({ columnType: 'jsonb', type: 'json' })
  payload!: Record<string, unknown>;

  @Enum(() => AssistantProposalSource)
  source!: AssistantProposalSource;

  @Enum(() => AssistantProposalStatus)
  status: AssistantProposalStatus = AssistantProposalStatus.PENDING;

  /** Plain text, written by the tool from the resolved names: "Categorize 3 transactions as Groceries". */
  @Property({ columnType: 'text' })
  summary!: string;

  @ManyToOne({ cascade: [], entity: () => Tenant, fieldName: 'tenant_key' })
  tenantKey!: Rel<Tenant>;
}
