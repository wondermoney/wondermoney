import { parse } from 'csv-parse/sync';

import { type PortfolioCsvLayout } from './portfolio-csv-column-mapping.schema';

export function applyPortfolioCsvLayout(rawRows: string[][], layout: PortfolioCsvLayout): Record<string, string>[] {
  const headerRow = rawRows[layout.headerRowIndex ?? 0];
  if (!headerRow || headerRow.length === 0) throw new Error('portfolio csv layout requires a header row');
  if ((layout.dataStartRowIndex ?? 0) <= (layout.headerRowIndex ?? 0)) throw new Error('dataStartRowIndex must be after headerRowIndex');

  const footerRowCount = layout.footerRowCount ?? 0;
  const lastDataRowIndex = Math.max(layout.dataStartRowIndex ?? 0, rawRows.length - footerRowCount);
  const headerCells = headerRow;

  const rows: Record<string, string>[] = [];
  for (let rowIndex = layout.dataStartRowIndex ?? 0; rowIndex < lastDataRowIndex; rowIndex += 1) {
    const row = rawRows[rowIndex] ?? [];
    if (row.every((cell: string) => cell.trim() === '')) continue;
    if (matchesFooterRow(row, layout.footerMatchers)) continue;

    const record: Record<string, string> = {};
    for (let columnIndex = 0; columnIndex < headerCells.length; columnIndex += 1) {
      const header = headerCells[columnIndex];
      if (!header) continue;
      record[header] = row[columnIndex] ?? '';
    }
    rows.push(record);
  }

  return rows;
}

export function normalizeCsvHeader(value: string): string {
  return value.trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function parseRawCsvRowsForLayout(csvText: string): string[][] {
  return parse(csvText, { bom: true, relax_column_count: true, skip_empty_lines: false });
}

function matchesFooterRow(row: string[], footerMatchers: string[] | undefined) {
  if (!footerMatchers?.length) return false;
  const normalizedJoinedRow = normalizeCsvHeader(row.join(' '));
  const normalizedCells = row.map((cell) => normalizeCsvHeader(cell)).filter(Boolean);
  return footerMatchers.some((matcher) => {
    const normalizedMatcher = normalizeCsvHeader(matcher);
    return normalizedMatcher.length > 0 && (normalizedJoinedRow.includes(normalizedMatcher) || normalizedCells.some((cell) => cell.includes(normalizedMatcher)));
  });
}
