import { createQueryClient } from './query-client'
import { purgeSensitiveState } from './purge-sensitive-state'

import packageJson from '../../../package.json'
import { onlineManager } from '@tanstack/react-query'

describe('query sensitive state purge', () => {
  afterEach(() => {
    onlineManager.setOnline(true)
  })

  it('seeds a financial query, proves it exists, purges it, and proves it is gone', async () => {
    const queryClient = createQueryClient()

    queryClient.setQueryData(['balances'], [{ id: 'bal_1', amount: 1250 }])

    expect(queryClient.getQueryData(['balances'])).toEqual([{ id: 'bal_1', amount: 1250 }])

    await purgeSensitiveState(queryClient)

    expect(queryClient.getQueryData(['balances'])).toBeUndefined()
  })

  it('aborts an active query before clearing state', async () => {
    const queryClient = createQueryClient()
    const signalEvents: string[] = []

    const query = queryClient.fetchQuery({
      queryKey: ['balances'],
      queryFn: async ({ signal }) => {
        return new Promise((_, reject) => {
          signal?.addEventListener(
            'abort',
            () => {
              signalEvents.push('aborted')
              reject(new Error('aborted'))
            },
            { once: true },
          )
        })
      },
    }).catch(() => undefined)

    expect(queryClient.getQueryCache().find({ queryKey: ['balances'] })).toBeDefined()

    await purgeSensitiveState(queryClient)
    await query

    expect(signalEvents).toContain('aborted')
    expect(queryClient.getQueryData(['balances'])).toBeUndefined()
  })

  it('still clears and propagates the original error when query cancellation fails', async () => {
    const failure = new Error('cancel failed')
    const clear = jest.fn()

    await expect(purgeSensitiveState({
      cancelQueries: async () => { throw failure },
      clear,
    })).rejects.toBe(failure)

    expect(clear).toHaveBeenCalledTimes(1)
  })

  it('does not install persistence packages or enable offline queues', () => {
    const queryClient = createQueryClient()
    const dependencies = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
    }
    const defaults = queryClient.getDefaultOptions()

    expect(dependencies).not.toHaveProperty('@tanstack/react-query-persist-client')
    expect(dependencies).not.toHaveProperty('@tanstack/query-async-storage-persister')
    expect(defaults.queries?.networkMode).toBe('online')
    expect(defaults.mutations?.networkMode).toBe('always')
  })

  it('runs an offline mutation once without pausing or replaying on reconnect', async () => {
    const queryClient = createQueryClient()
    const mutationFn = jest.fn().mockRejectedValue(new Error('offline'))
    const mutation = queryClient.getMutationCache().build(queryClient, { mutationFn })
    queryClient.mount()

    onlineManager.setOnline(false)
    const result = mutation.execute(undefined).catch((error: unknown) => error)
    await Promise.resolve()

    const callsBeforeReconnect = mutationFn.mock.calls.length
    const pausedBeforeReconnect = mutation.state.isPaused

    onlineManager.setOnline(true)
    await result
    queryClient.unmount()
    mutation.destroy()
    queryClient.getMutationCache().remove(mutation)

    expect(callsBeforeReconnect).toBe(1)
    expect(pausedBeforeReconnect).toBe(false)
    expect(mutationFn).toHaveBeenCalledTimes(1)
  })

  it('uses conservative retry and bounded cache defaults with no mutation retries', () => {
    const queryClient = createQueryClient()
    const defaults = queryClient.getDefaultOptions()

    expect(defaults.queries?.retry).toBe(false)
    expect(defaults.queries?.staleTime).toBe(30_000)
    expect(defaults.queries?.gcTime).toBe(5 * 60_000)
    expect(defaults.queries?.networkMode).toBe('online')
    expect(defaults.mutations?.retry).toBe(0)
    expect(defaults.mutations?.networkMode).toBe('always')
  })
})
