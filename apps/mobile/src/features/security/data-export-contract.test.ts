import { ApiError } from '@/lib/api/errors'

import { dataExportPasswordProblem, startDataExportBody } from './data-export-contract'
import { classifyDataExportFailure } from './use-data-export'

describe('dataExportPasswordProblem', () => {
  it('accepts 16 characters typed twice', () => {
    expect(dataExportPasswordProblem('a'.repeat(16), 'a'.repeat(16))).toBeNull()
  })

  it('rejects 15 characters before comparing the confirmation', () => {
    expect(dataExportPasswordProblem('a'.repeat(15), 'b')).toBe('too-short')
  })

  it('counts characters as the API does, so 16 accented letters are enough', () => {
    // 16 code points (32 bytes in UTF-8): the API counts 16.
    expect(dataExportPasswordProblem('é'.repeat(16), 'é'.repeat(16))).toBeNull()
    // An emoji is one character to the API though it is two UTF-16 units.
    expect(dataExportPasswordProblem('😀'.repeat(15), '😀'.repeat(15))).toBe('too-short')
  })

  it('rejects a confirmation that differs', () => {
    expect(dataExportPasswordProblem('a'.repeat(16), `${'a'.repeat(16)} `)).toBe('mismatch')
  })
})

describe('startDataExportBody', () => {
  it('sends no password field for an unprotected export', () => {
    expect(startDataExportBody(undefined)).toEqual({})
  })

  it('sends the password as typed', () => {
    expect(startDataExportBody(' sixteen chars ok ')).toEqual({ password: ' sixteen chars ok ' })
  })
})

describe('classifyDataExportFailure', () => {
  it.each([
    [429, 'limit'],
    [409, 'in-progress'],
    [400, 'password'],
    [500, 'unknown'],
  ] as const)('reads %i as %s', (status, failure) => {
    expect(classifyDataExportFailure(new ApiError('http', status))).toBe(failure)
  })

  it('reads a network failure or anything else as unknown', () => {
    expect(classifyDataExportFailure(new ApiError('network'))).toBe('unknown')
    expect(classifyDataExportFailure(new Error('boom'))).toBe('unknown')
  })
})
