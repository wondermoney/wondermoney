import { createRecurringOccurrencesEndpoint } from './recurring-contract'
import { recurringOccurrencesKey } from './query-keys'
import { useRecurringResource } from './use-recurring-resource'

export const useRecurringOccurrences = (from: string, to: string) =>
  useRecurringResource(createRecurringOccurrencesEndpoint(from, to), (epochId) => recurringOccurrencesKey(epochId, from, to))
