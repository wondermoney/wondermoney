import type { Rel } from '@mikro-orm/core';
import { Entity, ManyToOne, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy';

import { Appuser } from './Appuser';

/**
 * A member said "don't suggest this again" to a rule suggestion (`rule-suggestion.service.ts`).
 * `fingerprint` is a hash of the suggestion's pattern and category, so the row holds no
 * description text. Dismissals are per member and permanent; there is nothing to update or
 * soft-delete, so the entity has only its creation time.
 */
@Entity({ tableName: 'rule_suggestion_dismissal' })
@Unique({ name: 'rule_suggestion_dismissal_appuser_key_fingerprint_unique', properties: ['appuserKey', 'fingerprint'] })
export class RuleSuggestionDismissal {
  @ManyToOne({ cascade: [], deleteRule: 'cascade', entity: () => Appuser, fieldName: 'appuser_key' })
  appuserKey!: Rel<Appuser>;

  @Property({ columnType: 'timestamptz', onCreate: () => new Date() })
  createdAt = new Date();

  /** SHA-256 hex of the suggestion's pattern and category. */
  @Property({ length: 64 })
  fingerprint!: string;

  @PrimaryKey()
  ruleSuggestionDismissalKey!: number;
}
