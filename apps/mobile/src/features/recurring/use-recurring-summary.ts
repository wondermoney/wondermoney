import { recurringSummaryEndpoint } from './recurring-contract'
import { recurringSummaryKey } from './query-keys'
import { useRecurringResource } from './use-recurring-resource'

export const useRecurringSummary = () => useRecurringResource(recurringSummaryEndpoint, recurringSummaryKey)
