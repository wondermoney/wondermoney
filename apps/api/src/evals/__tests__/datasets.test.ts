import { beforeAll, describe, expect, it } from 'vitest';

import { applyStatementMapping, inferFormats, readStatementGrid } from '@service/account/account-statement-reader';
import { parseCsvRows } from '@service/account/csv-upload-boundary.service';
import { validateConfirmedPortfolioColumnMapping } from '@service/portfolio/portfolio-csv-column-mapping.schema';

import { isFilteredByEligibility } from '../categorization';
import { ABSTAIN, type CategorizationDataset, type CsvMappingDataset, loadCategorizationDataset, loadCsvMappingDataset, loadThresholds, type Thresholds } from '../datasets';
import { checkThresholds, computeCategorizationMetrics, computeCsvMappingMetrics } from '../metrics';

describe('eval golden sets', () => {
  let categorization: CategorizationDataset;
  let csvMapping: CsvMappingDataset;
  let thresholds: Thresholds;

  beforeAll(async () => {
    [categorization, csvMapping, thresholds] = await Promise.all([loadCategorizationDataset(), loadCsvMappingDataset(), loadThresholds()]);
  });

  describe('categorization', () => {
    it('covers about 300 items in English, Portuguese and Spanish', () => {
      expect(categorization.items.length).toBeGreaterThanOrEqual(250);
      const languages = new Set(categorization.items.map((item) => item.language));
      expect([...languages].sort()).toEqual(['en', 'es', 'pt']);
    });

    it('has uncategorisable items in every language, both ones the eligibility filter drops and ones that reach the model', () => {
      for (const language of ['en', 'es', 'pt']) {
        const abstain = categorization.items.filter((item) => item.language === language && item.expected === ABSTAIN);
        expect({ filtered: abstain.some(isFilteredByEligibility), language, reachesModel: abstain.some((item) => !isFilteredByEligibility(item)) }).toEqual({ filtered: true, language, reachesModel: true });
      }
    });

    it('never expects a category for an item production keeps away from every categorizer', () => {
      const unreachable = categorization.items.filter((item) => item.expected !== ABSTAIN && isFilteredByEligibility(item)).map((item) => item.id);
      expect(unreachable).toEqual([]);
    });

    it('expects only specific categories, never the uninformative OTHER that write mode refuses', () => {
      expect(categorization.items.filter((item) => item.expected === 'OTHER')).toEqual([]);
    });
  });

  describe('CSV mapping', () => {
    it('covers about 40 statement and broker exports', () => {
      expect(csvMapping.items.length).toBeGreaterThanOrEqual(35);
      expect(csvMapping.items.filter((item) => item.kind === 'account').length).toBeGreaterThanOrEqual(15);
      expect(csvMapping.items.filter((item) => item.kind === 'portfolio').length).toBeGreaterThanOrEqual(15);
    });

    it('expects statement mappings that read every row of their file', async () => {
      for (const item of csvMapping.items) {
        if (item.kind !== 'account') continue;
        const grid = await readStatementGrid(Buffer.from(item.csv, 'utf8'));
        const { columns, headerRowIndex } = item.expected;
        const { date, description } = columns;
        expect({ date: typeof date, description: typeof description, id: item.id }).toEqual({ date: 'number', description: 'number', id: item.id });
        if (date === undefined || description === undefined) continue;
        const formats = inferFormats(grid, headerRowIndex, columns);
        const applied = applyStatementMapping(grid, { columns: { ...columns, date, description }, dateFormat: formats.dateFormat, decimalSeparator: formats.decimalSeparator, headerRowIndex, invertAmounts: item.expected.spendingIsPositive });
        const dataRows = grid.slice(headerRowIndex + 1).filter((row) => row.some((cell) => cell !== '')).length;
        expect({ id: item.id, invalid: applied.invalid, read: applied.rows.length }).toEqual({ id: item.id, invalid: [], read: dataRows });
      }
    });

    it('expects broker mappings to name real headers and to be complete enough to confirm', () => {
      for (const item of csvMapping.items) {
        if (item.kind !== 'portfolio') continue;
        const headers = Object.keys(parseCsvRows<Record<string, string>>(item.csv)[0] ?? {});
        const unknown = Object.values(item.expected.columnMapping).filter((header) => !headers.includes(header));
        expect({ id: item.id, unknown }).toEqual({ id: item.id, unknown: [] });
        const fixedValues = item.expected.fixedCurrency ? { currency: item.expected.fixedCurrency as 'EUR' } : {};
        expect(() => validateConfirmedPortfolioColumnMapping({ columnMapping: item.expected.columnMapping, fixedValues, transformations: {} })).not.toThrow();
      }
    });
  });

  it('bounds only metrics the report computes', () => {
    const results = [
      ...checkThresholds('categorization.llm', { ...computeCategorizationMetrics([]) }, thresholds.categorization.llm),
      ...checkThresholds('categorization.bayes', { ...computeCategorizationMetrics([]) }, thresholds.categorization.bayes),
      ...checkThresholds('csvMapping', { ...computeCsvMappingMetrics([]) }, thresholds.csvMapping),
    ];
    expect(results.length).toBeGreaterThan(0);
    expect(results.filter((result) => !result.passed)).toEqual([]);
  });
});
