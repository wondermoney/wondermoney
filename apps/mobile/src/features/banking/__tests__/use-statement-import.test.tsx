import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react-native'
import type { ReactNode } from 'react'

import { ApiError } from '@/lib/api/errors'

import { useStatementImport } from '../use-statement-import'

const mockRead = jest.fn()
const mockWrite = jest.fn()
const mockBlockAccess = jest.fn()
const mockUpload = jest.fn()

jest.mock('@/components/providers/product-runtime-provider', () => ({
  useProductRuntime: () => ({ runtime: { epochId: 9, apiClient: { read: mockRead, write: mockWrite } }, blockAccess: mockBlockAccess }),
}))
jest.mock('../statement-import-upload', () => ({ uploadStatementImportFile: (...args: unknown[]) => mockUpload(...args) }))

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return { client, wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> }
}

const session = {
  importSessionId: 41, maxUploadSizeBytes: 1000, status: 'waiting_for_upload',
  uploadHeaders: { 'Content-Type': 'text/csv' }, uploadMethod: 'PUT', uploadUrl: 'https://s3.example/upload',
}
const parseTrigger = { importSessionId: 41, status: 'parsing' }
const succeededStatus = { importSessionId: 41, status: 'succeeded', summary: { duplicateRows: 1, failedRows: 0, importedRows: 9, totalRows: 10 } }
const failedStatus = { importSessionId: 41, status: 'failed' }

const file = { uri: 'file:///picked.csv', name: 'picked.csv' }
const noWait = { wait: async () => undefined }

describe('useStatementImport', () => {
  beforeEach(() => { mockRead.mockReset(); mockWrite.mockReset(); mockBlockAccess.mockReset(); mockUpload.mockReset() })

  it('runs the full upload -> parse -> poll flow through to succeeded', async () => {
    mockWrite.mockResolvedValueOnce(session).mockResolvedValueOnce(parseTrigger)
    mockUpload.mockResolvedValue(undefined)
    mockRead.mockResolvedValueOnce(succeededStatus)

    const { client, wrapper } = setup()
    const invalidate = jest.spyOn(client, 'invalidateQueries')
    const hook = await renderHook(() => useStatementImport(noWait), { wrapper })
    await act(async () => { await hook.result.current.start(12, file) })

    expect(mockWrite.mock.calls[0]?.[0].path).toBe('/v1/account/12/statement-imports')
    expect(mockUpload).toHaveBeenCalledWith('file:///picked.csv', 'https://s3.example/upload', { 'Content-Type': 'text/csv' })
    expect(mockWrite.mock.calls[1]?.[0].path).toBe('/v1/banking/statement-imports/41/parse')
    expect(mockRead.mock.calls[0]?.[0].path).toBe('/v1/banking/statement-imports/41')
    expect(hook.result.current.state).toEqual({ phase: 'succeeded', summary: succeededStatus.summary })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['accounts', 9], exact: true })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['account', 9, 12], exact: true })
    await hook.unmount(); client.clear()
  })

  it('accepts a partial-success terminal status', async () => {
    mockWrite.mockResolvedValueOnce(session).mockResolvedValueOnce(parseTrigger)
    mockUpload.mockResolvedValue(undefined)
    mockRead.mockResolvedValueOnce({ ...succeededStatus, status: 'partial' })

    const { client, wrapper } = setup()
    const hook = await renderHook(() => useStatementImport(noWait), { wrapper })
    await act(async () => { await hook.result.current.start(12, file) })

    expect(hook.result.current.state.phase).toBe('succeeded')
    await hook.unmount(); client.clear()
  })

  it('reports upload-failed without triggering parse when the presigned upload fails', async () => {
    mockWrite.mockResolvedValueOnce(session)
    mockUpload.mockRejectedValue(new Error('network blip'))

    const { client, wrapper } = setup()
    const hook = await renderHook(() => useStatementImport(noWait), { wrapper })
    await act(async () => { await hook.result.current.start(12, file) })

    expect(hook.result.current.state).toEqual({ phase: 'failed', reason: 'upload-failed' })
    expect(mockWrite).toHaveBeenCalledTimes(1)
    await hook.unmount(); client.clear()
  })

  it('reports processing-failed when the terminal status is failed', async () => {
    mockWrite.mockResolvedValueOnce(session).mockResolvedValueOnce(parseTrigger)
    mockUpload.mockResolvedValue(undefined)
    mockRead.mockResolvedValueOnce(failedStatus)

    const { client, wrapper } = setup()
    const hook = await renderHook(() => useStatementImport(noWait), { wrapper })
    await act(async () => { await hook.result.current.start(12, file) })

    expect(hook.result.current.state).toEqual({ phase: 'failed', reason: 'processing-failed' })
    await hook.unmount(); client.clear()
  })

  it('polls repeatedly through in-flight statuses before proceeding', async () => {
    mockWrite.mockResolvedValueOnce(session).mockResolvedValueOnce(parseTrigger)
    mockUpload.mockResolvedValue(undefined)
    mockRead
      .mockResolvedValueOnce({ importSessionId: 41, status: 'uploaded' })
      .mockResolvedValueOnce({ importSessionId: 41, status: 'parsing' })
      .mockResolvedValueOnce({ importSessionId: 41, status: 'importing' })
      .mockResolvedValueOnce(succeededStatus)

    const { client, wrapper } = setup()
    const hook = await renderHook(() => useStatementImport(noWait), { wrapper })
    await act(async () => { await hook.result.current.start(12, file) })

    expect(mockRead).toHaveBeenCalledTimes(4)
    expect(hook.result.current.state).toEqual({ phase: 'succeeded', summary: succeededStatus.summary })
    await hook.unmount(); client.clear()
  })

  it('classifies an MFA error and blocks access', async () => {
    mockWrite.mockRejectedValueOnce(new ApiError('mfa-required', 403))

    const { client, wrapper } = setup()
    const hook = await renderHook(() => useStatementImport(noWait), { wrapper })
    await act(async () => { await hook.result.current.start(12, file) })

    expect(hook.result.current.state).toEqual({ phase: 'failed', reason: 'mfa' })
    expect(mockBlockAccess).toHaveBeenCalledWith('mfa-required')
    await hook.unmount(); client.clear()
  })

  it('classifies demo-forbidden distinctly from access', async () => {
    mockWrite.mockRejectedValueOnce(new ApiError('demo-forbidden'))

    const { client, wrapper } = setup()
    const hook = await renderHook(() => useStatementImport(noWait), { wrapper })
    await act(async () => { await hook.result.current.start(12, file) })

    expect(hook.result.current.state).toEqual({ phase: 'failed', reason: 'demo' })
    await hook.unmount(); client.clear()
  })

  it('resets back to idle', async () => {
    mockWrite.mockResolvedValueOnce(session)
    mockUpload.mockRejectedValue(new Error('boom'))

    const { client, wrapper } = setup()
    const hook = await renderHook(() => useStatementImport(noWait), { wrapper })
    await act(async () => { await hook.result.current.start(12, file) })
    expect(hook.result.current.state.phase).toBe('failed')
    await act(async () => { hook.result.current.reset() })
    expect(hook.result.current.state).toEqual({ phase: 'idle' })
    await hook.unmount(); client.clear()
  })
})
