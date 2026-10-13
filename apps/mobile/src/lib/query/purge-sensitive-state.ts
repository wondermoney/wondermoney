import type { QueryClient } from '@tanstack/react-query'

export type SensitiveStateQueryClient = Pick<QueryClient, 'cancelQueries' | 'clear'>

export const purgeSensitiveState = async (queryClient: SensitiveStateQueryClient) => {
  try {
    await queryClient.cancelQueries()
  } finally {
    queryClient.clear()
  }
}
