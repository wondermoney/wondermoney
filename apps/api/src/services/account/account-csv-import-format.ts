import { csv } from '@wondermoney/shared';

/**
 * Which file an account's CSV import reads. An account at one of the supported banks reads that
 * bank's statement export; every other account (an unsupported bank, or a manual account with no
 * financial institution) reads the generic CSV format, whose columns are fixed by
 * `AccountCsvImportService.importAccountCsv`.
 *
 * `bankName` is a name `csv.getBankParser` accepts. Institution names are matched ignoring case
 * and spaces, because the same bank is listed under more than one spelling: the seeded institution
 * list has both "Activo Bank" and "Banco ActivoBank", and a manual account can be created on
 * either.
 */
export type AccountCsvImportFormat = { bankName: string; format: 'bank' } | { format: 'generic' };

const compact = (name: string) => name.toLowerCase().replace(/\s+/g, '');
const SUPPORTED_BY_COMPACT_NAME = new Map<string, csv.SupportedBanks>(csv.SUPPORTED_BANKS_CSV_IMPORT.map((name) => [compact(name), name]));

export function resolveAccountCsvImportFormat(institutionName: null | string | undefined): AccountCsvImportFormat {
  if (!institutionName) return { format: 'generic' };
  if (csv.SUPPORTED_BANKS_CSV_IMPORT.includes(institutionName.toLowerCase() as csv.SupportedBanks)) {
    return { bankName: institutionName, format: 'bank' };
  }
  const supported = SUPPORTED_BY_COMPACT_NAME.get(compact(institutionName));
  return supported ? { bankName: supported, format: 'bank' } : { format: 'generic' };
}
