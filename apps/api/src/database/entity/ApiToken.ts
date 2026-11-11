import type { Rel } from '@mikro-orm/core';
import { Entity, Filter, Index, ManyToOne, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy';

import { TENANT_FILTER, tenantScopedCond } from '../filters/tenant-filter';

import { Appuser } from './Appuser';
import { Base } from './BaseEntity';
import { Tenant } from './Tenant';

/**
 * The scopes a personal API token can carry.
 *
 * `read` allows GET/HEAD on the data routes in `@middleware/api-token-policy`.
 * `write` allows create/update on transactions, accounts, categories, budgets and goals,
 * and implies `read` on those same routes: a script that writes a transaction almost always
 * needs to read it back. Neither scope can delete anything.
 */
export const API_TOKEN_SCOPES = ['read', 'write'] as const;
export type ApiTokenScope = (typeof API_TOKEN_SCOPES)[number];

/**
 * A personal access token for scripts, spreadsheets, dashboards and AI tools.
 *
 * Only the SHA-256 hash of the token is stored. The plain token is returned once, at
 * creation, and never persisted or logged. `prefix` is the display fragment
 * (`wm_pat_` plus the first eight random characters) shown in the settings list.
 */
@Entity()
@Filter({ args: false, cond: tenantScopedCond, default: true, name: TENANT_FILTER })
@Index({ properties: ['appuserKey'] })
@Index({ properties: ['tenantKey'] })
export class ApiToken extends Base {
  @PrimaryKey()
  apiTokenKey!: number;

  @ManyToOne({ cascade: [], entity: () => Appuser, fieldName: 'appuser_key' })
  appuserKey!: Rel<Appuser>;

  @Property({ length: 80 })
  name!: string;

  @ManyToOne({ cascade: [], entity: () => Tenant, fieldName: 'tenant_key' })
  tenantKey!: Rel<Tenant>;

  /** `wm_pat_` plus the first eight characters of the random part, for the settings list. */
  @Property({ length: 32 })
  prefix!: string;

  /** SHA-256 hex digest of the full token. The plain token is never stored. */
  @Property({ columnType: 'timestamptz' })
  expiresAt!: Date;

  @Property({ columnType: 'timestamptz', nullable: true })
  lastUsedAt?: Date;

  @Property({ length: 64, nullable: true })
  lastUsedIp?: string;

  @Property({ columnType: 'timestamptz', nullable: true })
  revokedAt?: Date;

  @Property({ columnType: 'jsonb', type: 'json' })
  scopes: ApiTokenScope[] = [];

  @Property({ length: 64 })
  @Unique()
  secretHash!: string;

  /** Set once the seven-day expiry reminder has been sent, so the daily job does not repeat it. */
  @Property({ columnType: 'timestamptz', nullable: true })
  reminderSentAt?: Date;
}
