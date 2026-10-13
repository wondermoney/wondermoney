import { recurringItemsEndpoint } from './recurring-contract'
import { recurringItemsKey } from './query-keys'
import { useRecurringResource } from './use-recurring-resource'

export const useRecurringItems = () => useRecurringResource(recurringItemsEndpoint, recurringItemsKey)
