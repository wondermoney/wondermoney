import { shareReportCsv } from './report-csv-export'

const mockIsAvailableAsync = jest.fn()
const mockShareAsync = jest.fn()
jest.mock('expo-sharing', () => ({
  isAvailableAsync: () => mockIsAvailableAsync(),
  shareAsync: (...args: unknown[]) => mockShareAsync(...args),
}))

const mockDelete = jest.fn()
const mockCreate = jest.fn()
const mockWrite = jest.fn()
let mockExists = false
const mockFileInstances: { uri: string }[] = []
jest.mock('expo-file-system', () => ({
  Paths: { cache: { uri: 'file:///cache/' } },
  File: jest.fn().mockImplementation((_dir: unknown, filename: string) => {
    const instance = {
      uri: `file:///cache/${filename}`,
      get exists() { return mockExists },
      delete: mockDelete,
      create: mockCreate,
      write: mockWrite,
    }
    mockFileInstances.push(instance)
    return instance
  }),
}))

describe('shareReportCsv', () => {
  beforeEach(() => {
    mockIsAvailableAsync.mockReset().mockResolvedValue(true)
    mockShareAsync.mockReset().mockResolvedValue(undefined)
    mockDelete.mockReset()
    mockCreate.mockReset()
    mockWrite.mockReset()
    mockExists = false
    mockFileInstances.length = 0
  })

  it('creates the cache file, writes the CSV text, and shares it with a CSV mime type', async () => {
    await shareReportCsv('month,net\n2026-08,500', 'cashflow-2026-08-11.csv')
    expect(mockCreate).toHaveBeenCalledTimes(1)
    expect(mockWrite).toHaveBeenCalledWith('month,net\n2026-08,500')
    expect(mockShareAsync).toHaveBeenCalledWith('file:///cache/cashflow-2026-08-11.csv', {
      mimeType: 'text/csv', UTI: 'public.comma-separated-values-text',
    })
  })

  it('deletes a pre-existing file at the same path before recreating it', async () => {
    mockExists = true
    await shareReportCsv('a,b', 'report.csv')
    expect(mockDelete).toHaveBeenCalledTimes(1)
    expect(mockCreate).toHaveBeenCalledTimes(1)
  })

  it('does not attempt to delete when no file exists yet', async () => {
    mockExists = false
    await shareReportCsv('a,b', 'report.csv')
    expect(mockDelete).not.toHaveBeenCalled()
  })

  it('throws without writing or sharing when the OS share sheet is unavailable', async () => {
    mockIsAvailableAsync.mockResolvedValue(false)
    await expect(shareReportCsv('a,b', 'report.csv')).rejects.toThrow('Sharing is not available on this device.')
    expect(mockWrite).not.toHaveBeenCalled()
    expect(mockShareAsync).not.toHaveBeenCalled()
  })
})
