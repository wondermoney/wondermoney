import type { Rel } from '@mikro-orm/core';
import { Entity, Enum, Filter, Index, ManyToOne, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';

import type { RuleAction, RuleCondition } from '@service/rules/rule-schema';

import { TENANT_FILTER, tenantScopedCond } from '../filters/tenant-filter';

import { Appuser } from './Appuser';
import { Base } from './BaseEntity';
import { Tenant } from './Tenant';

export enum RuleMatchMode {
  ALL = 'all',
  ANY = 'any',
}

/**
 * A household's automation rule: when a transaction meets the conditions (all or any), apply
 * the actions. Rules run in `position` order (unique per household among live rows); a matching
 * rule with `stopProcessing` ends the run. The engine is `services/rules/rule-engine.ts`; the
 * shape of `conditions` and `actions` is `services/rules/rule-schema.ts`, at `version`.
 *
 * Both members of a household see and manage every rule. A rule acts only on transactions its
 * owner can see (the `Transaction` tenant filter's private-account rule), so it never touches the
 * other member's private accounts. Whoever last changed a rule's conditions or actions becomes
 * its owner: a member cannot reach into the other's private accounts by editing their rule.
 */
@Entity()
@Filter({ args: false, cond: tenantScopedCond, default: true, name: TENANT_FILTER })
@Index({
  expression: 'CREATE UNIQUE INDEX rule_tenant_key_position_unique ON rule (tenant_key, position) WHERE deleted_at IS NULL',
  name: 'rule_tenant_key_position_unique',
})
export class Rule extends Base {
  @Property({ columnType: 'jsonb', type: 'json' })
  actions!: RuleAction[];

  @Property({ default: true })
  active = true;

  @Property({ columnType: 'jsonb', type: 'json' })
  conditions!: RuleCondition[];

  @Enum({ default: RuleMatchMode.ALL, items: () => RuleMatchMode })
  match: RuleMatchMode = RuleMatchMode.ALL;

  @Property({ length: 100 })
  name!: string;

  /** The member the rule acts for (see the class comment). Null once that user is gone. */
  @ManyToOne({ cascade: [], deleteRule: 'set null', entity: () => Appuser, fieldName: 'owner_appuser_key', nullable: true })
  ownerAppuserKey?: null | Rel<Appuser>;

  @Property()
  position!: number;

  @PrimaryKey()
  ruleKey!: number;

  @Property({ default: false })
  stopProcessing = false;

  @ManyToOne({ cascade: [], entity: () => Tenant, fieldName: 'tenant_key' })
  tenantKey!: Rel<Tenant>;

  /** Version of the conditions/actions shape the row was written with. */
  @Property({ columnType: 'smallint', default: 1 })
  version = 1;
}
