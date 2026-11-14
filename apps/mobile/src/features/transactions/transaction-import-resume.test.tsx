import { act, renderHook, waitFor } from '@testing-library/react-native'
import * as SecureStore from 'expo-secure-store'

import { type PendingTransactionImport, type PendingTransactionImportStorage, secureStorePendingTransactionImport, useTransactionImportResume } from './transaction-import-resume'

jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>()
  return {
    getItemAsync: jest.fn(async (key: string) => store.get(key) ?? null),
    setItemAsync: jest.fn(async (key: string, value: string) => { store.set(key, value) }),
    deleteItemAsync: jest.fn(async (key: string) => { store.delete(key) }),
  }
})

const pending = { sessionId: '0b3c9a52-7d3e-4c4e-9d55-6f1b2a3c4d5e', expiresAt: '2026-11-19T10:00:00.000Z' }

describe('secureStorePendingTransactionImport', () => {
  beforeEach(async () => { await secureStorePendingTransactionImport.clear() })

  it('keeps the unfinished import for the person who started it', async () => {
    await secureStorePendingTransactionImport.save('person-1', pending)
    await expect(secureStorePendingTransactionImport.load('person-1')).resolves.toEqual(pending)
    // Another sign-in on the device never resumes it.
    await expect(secureStorePendingTransactionImport.load('person-2')).resolves.toBeNull()
  })

  it('forgets it once cleared', async () => {
    await secureStorePendingTransactionImport.save('person-1', pending)
    await secureStorePendingTransactionImport.clear()
    await expect(secureStorePendingTransactionImport.load('person-1')).resolves.toBeNull()
  })

  it('reads an unreadable stored value as nothing to resume', async () => {
    await SecureStore.setItemAsync('wondermoney.transaction-import.pending', '{not json')
    await expect(secureStorePendingTransactionImport.load('person-1')).resolves.toBeNull()
    await SecureStore.setItemAsync('wondermoney.transaction-import.pending', JSON.stringify({ principalId: 'person-1', sessionId: 42 }))
    await expect(secureStorePendingTransactionImport.load('person-1')).resolves.toBeNull()
  })

  it('reads a storage failure as nothing to resume', async () => {
    jest.mocked(SecureStore.getItemAsync).mockRejectedValueOnce(new Error('locked'))
    await expect(secureStorePendingTransactionImport.load('person-1')).resolves.toBeNull()
  })
})

describe('useTransactionImportResume', () => {
  function memoryStorage(initial: PendingTransactionImport | null) {
    let value = initial
    return {
      load: jest.fn<Promise<PendingTransactionImport | null>, [string]>(async () => value),
      save: jest.fn<Promise<void>, [string, PendingTransactionImport]>(async (_principalId, next) => { value = next }),
      clear: jest.fn<Promise<void>, []>(async () => { value = null }),
    } satisfies PendingTransactionImportStorage
  }

  it('finds the unfinished import when the person returns', async () => {
    const storage = memoryStorage(pending)
    let release: () => void = () => undefined
    const loaded = new Promise<void>((resolve) => { release = resolve })
    storage.load.mockImplementationOnce(async () => { await loaded; return pending })
    const hook = await renderHook(() => useTransactionImportResume('person-1', storage))
    expect(hook.result.current.checking).toBe(true)
    await act(async () => { release() })
    await waitFor(() => expect(hook.result.current.checking).toBe(false))
    expect(hook.result.current.pending).toEqual(pending)
    expect(storage.load).toHaveBeenCalledWith('person-1')
    await hook.unmount()
  })

  it('remembers a staged import and forgets it', async () => {
    const storage = memoryStorage(null)
    const hook = await renderHook(() => useTransactionImportResume('person-1', storage))
    await waitFor(() => expect(hook.result.current.checking).toBe(false))
    expect(hook.result.current.pending).toBeNull()

    await act(async () => { await hook.result.current.remember({ id: pending.sessionId, expiresAt: pending.expiresAt }) })
    expect(storage.save).toHaveBeenCalledWith('person-1', pending)

    await act(async () => { await hook.result.current.forget() })
    expect(storage.clear).toHaveBeenCalledTimes(1)
    await hook.unmount()
  })
})
