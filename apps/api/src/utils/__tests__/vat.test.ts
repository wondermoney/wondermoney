import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import { checkIfVATIsValid, stripPTPrefixFromVAT } from '@utils/vat';

vi.mock('jsvat-next', () => {
  return {
    checkVAT: vi.fn((value: string) => {
      if (value === 'PT123456789') return { isValid: true, value };
      if (value === 'ESX1234567') return { isValid: true, value };
      return { isValid: false, value: undefined };
    }),
    europe: {},
    portugal: {},
    spain: {},
  };
});

describe('vat utils', () => {
  it('sanitizes PT VAT numbers by prefixing PT when missing and validates', () => {
    const result = checkIfVATIsValid('123456789', 'PT');
    expect(result.isValid).toBe(true);
    expect(result.value).toBe('PT123456789');
  });

  it('sanitizes ES VAT numbers by prefixing ES when missing and validates', () => {
    const result = checkIfVATIsValid('X1234567', 'ES');
    expect(result.isValid).toBe(true);
    expect(result.value).toBe('ESX1234567');
  });

  it('returns invalid when checkVAT fails', () => {
    const result = checkIfVATIsValid('999', 'PT');
    expect(result.isValid).toBe(false);
    expect(result.value).toBeUndefined();
  });

  it('validates VAT numbers through the tsx runtime import path', () => {
    const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
    const output = execFileSync(
      process.execPath,
      [
        '--import',
        'tsx',
        '--input-type=module',
        '-e',
        "import { checkIfVATIsValid } from './src/utils/vat.ts'; console.log(JSON.stringify(checkIfVATIsValid('PT999999990', 'PT')));",
      ],
      { cwd: apiRoot, encoding: 'utf8' },
    ).trim();

    expect(JSON.parse(output)).toEqual({ isValid: true, value: 'PT999999990' });
  });

  it('strips PT prefix when present', () => {
    expect(stripPTPrefixFromVAT('PT123456789')).toBe('123456789');
    expect(stripPTPrefixFromVAT('ES123')).toBe('ES123');
  });
});
