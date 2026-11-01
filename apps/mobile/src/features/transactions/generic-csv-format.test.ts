import Papa from 'papaparse'

import {
  buildGenericCsvTemplate,
  decideUpload,
  GENERIC_CSV_COLUMNS,
  importFlowForAccount,
  isCsvFileName,
  rowsFailedCounts,
} from './generic-csv-format'

describe('importFlowForAccount', () => {
  it.each([
    ['bank', 'bank'],
    ['generic', 'generic'],
    ['unknown', 'unknown'],
    [null, 'legacy'],
    [undefined, 'legacy'],
  ] as const)('offers the %s account the %s flow', (format, flow) => {
    expect(importFlowForAccount(format)).toBe(flow)
  })
})

describe('decideUpload', () => {
  it('imports in the format the API reports, whatever isSupportedBank says', () => {
    expect(decideUpload({ csvImportFormat: 'generic', isSupportedBank: false })).toEqual({ action: 'import', format: 'generic' })
    expect(decideUpload({ csvImportFormat: 'bank', isSupportedBank: true })).toEqual({ action: 'import', format: 'bank' })
  })

  it('stops on a format this build does not know', () => {
    expect(decideUpload({ csvImportFormat: 'unknown', isSupportedBank: true })).toEqual({ action: 'stop', reason: 'unknown-format' })
  })

  it('falls back to isSupportedBank on an API that reports no format', () => {
    expect(decideUpload({ isSupportedBank: true })).toEqual({ action: 'import', format: 'bank' })
    expect(decideUpload({ isSupportedBank: false })).toEqual({ action: 'stop', reason: 'unsupported-bank' })
  })
})

describe('buildGenericCsvTemplate', () => {
  const parse = (csv: string) => Papa.parse<Record<string, string>>(csv.replace(/^﻿/, ''), { header: true, skipEmptyLines: true })

  it('has exactly the columns the API accepts, and example rows with the instance\'s type codes', () => {
    const parsed = parse(buildGenericCsvTemplate([{ transactionTypeKey: 3, name: 'PAYMENT' }, { transactionTypeKey: 8, name: 'DEPOSIT' }]))
    expect(parsed.meta.fields).toEqual([...GENERIC_CSV_COLUMNS])
    expect(parsed.data.map((row) => row.transactionTypeKey)).toEqual(['3', '8'])
    expect(parsed.data.every((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.date ?? ''))).toBe(true)
  })

  it('is only the header when the type codes are not known', () => {
    const parsed = parse(buildGenericCsvTemplate())
    expect(parsed.meta.fields).toEqual([...GENERIC_CSV_COLUMNS])
    expect(parsed.data).toEqual([])
  })

  it('starts with a BOM so spreadsheet apps read it as UTF-8', () => {
    expect(buildGenericCsvTemplate().startsWith('﻿')).toBe(true)
  })
})

describe('isCsvFileName', () => {
  it.each(['a.csv', 'A.CSV', 'statement.csv '])('accepts %s', (name) => expect(isCsvFileName(name)).toBe(true))
  it.each(['a.xlsx', 'a.csv.txt', 'csv'])('refuses %s', (name) => expect(isCsvFileName(name)).toBe(false))
})

describe('rowsFailedCounts', () => {
  const rows = { failed: 1, total: 2 }

  it.each(['partial', 'failed'])('reports the rejected rows of a %s generic import', (outcome) => {
    expect(rowsFailedCounts('generic', outcome, rows)).toEqual(rows)
  })

  it('says nothing for a bank import, a succeeded import, no rejected rows, or no counts', () => {
    expect(rowsFailedCounts('bank', 'partial', rows)).toBeNull()
    expect(rowsFailedCounts('generic', 'succeeded', rows)).toBeNull()
    expect(rowsFailedCounts('generic', 'failed', { failed: 0, total: 2 })).toBeNull()
    expect(rowsFailedCounts('generic', 'partial', null)).toBeNull()
  })
})
