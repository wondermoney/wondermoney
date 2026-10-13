import { Entity, Enum, Index, ManyToOne, PrimaryKey, Property } from '@mikro-orm/core';
import type { Rel } from '@mikro-orm/core';

import { RecurringOccurrenceMatchStatus } from '@service/recurring/recurring-types';

import { Base } from './BaseEntity';
import { Currency } from './Currency';
import { RecurringSeries } from './RecurringSeries';
import { Transaction } from './Transaction';

@Entity({ tableName: 'recurring_occurrence' })
@Index({ name: 'recurring_occurrence_series_occurrence_date_index', properties: ['recurringSeriesKey', 'occurrenceDate'] })
@Index({
  expression:
    'CREATE INDEX recurring_occurrence_transaction_key_index ON recurring_occurrence (transaction_key) WHERE transaction_key IS NOT NULL',
  name: 'recurring_occurrence_transaction_key_index',
})
@Index({
  expression:
    'CREATE UNIQUE INDEX recurring_occurrence_series_transaction_unique ON recurring_occurrence (recurring_series_key, transaction_key) WHERE transaction_key IS NOT NULL',
  name: 'recurring_occurrence_series_transaction_unique',
})
export class RecurringOccurrence extends Base {
  @Property({ columnType: 'numeric(18, 4)', nullable: true })
  amount?: number;

  @ManyToOne({ cascade: [], entity: () => Currency, fieldName: 'currency_key', nullable: true })
  currencyKey?: Rel<Currency>;

  @Enum(() => RecurringOccurrenceMatchStatus)
  matchStatus: RecurringOccurrenceMatchStatus = RecurringOccurrenceMatchStatus.matched;

  @Property({ columnType: 'timestamptz' })
  occurrenceDate!: Date;

  @PrimaryKey()
  recurringOccurrenceKey!: number;

  @ManyToOne({ cascade: [], entity: () => RecurringSeries, fieldName: 'recurring_series_key' })
  recurringSeriesKey: Rel<RecurringSeries>;

  @ManyToOne({ cascade: [], entity: () => Transaction, fieldName: 'transaction_key', nullable: true })
  transactionKey?: Rel<Transaction>;
}
