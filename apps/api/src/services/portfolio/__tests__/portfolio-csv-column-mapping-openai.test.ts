import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({
  completeJson: vi.fn(),
}));

vi.mock('@service/ai/complete-json', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@service/ai/complete-json')>();
  return { ...actual, completeJson: mocked.completeJson };
});

const suggestion = {
  columnMapping: { assetName: 'Asset', currency: 'Currency', quantity: 'Qty', transactionDate: 'Date', unitPrice: 'Price' },
  confidence: 0.91,
  detectedBroker: null,
  layout: { dataStartRowIndex: 1, footerMatchers: null, footerRowCount: null, headerRowIndex: 0 },
  transformations: { dateFormat: null, decimalSeparator: null, negativeAmountMeansBuy: null, quantitySignIndicatesDirection: null, thousandsSeparator: null },
  warnings: [],
};

const completion = { object: suggestion, tokens: { completionTokens: 2, promptTokens: 3, totalTokens: 5 } };

describe('portfolio csv column mapping openai', () => {
  beforeEach(() => {
    vi.resetModules();
    mocked.completeJson.mockReset();
  });

  it('builds the request with bounded sample rows and parses the suggestion', async () => {
    mocked.completeJson.mockResolvedValue(completion);

    const { requestPortfolioColumnMappingSuggestion } = await import('../portfolio-csv-column-mapping-openai');

    await expect(requestPortfolioColumnMappingSuggestion({ headers: ['Date', 'Qty'], rowShapes: [{ cellCount: 2, emptyCellCount: 0, nonEmptyCellCount: 2 }], sampleRows: Array.from({ length: 7 }, (_, index) => ({ emptyCellCount: 0, hasNumericCells: true, hasTextCells: true, headerCount: 2, nonEmptyCellCount: 2, rowIndex: index })) })).resolves.toMatchObject({
      suggestion: { columnMapping: { assetName: 'Asset' }, confidence: 0.91 },
      tokens: { completionTokens: 2, promptTokens: 3, totalTokens: 5 },
    });

    const request = mocked.completeJson.mock.calls[0]?.[0];
    expect(request).toMatchObject({
      azureDeployment: 'gpt-5.4-nano',
      feature: 'csvMapping',
      schemaName: 'portfolio_column_mapping',
    });
    expect(request.schema).toBeDefined();
    const userMessage = request.user as string;
    expect(userMessage).toContain('"headers":["Date","Qty"]');
    expect(userMessage).toContain('"rowShapes"');
    expect(userMessage).toContain('"sampleRows"');
    expect(String(request.system)).toContain('real table header row and any footer rows');
    expect(userMessage).not.toContain('2024-01-05');
    expect(userMessage).not.toContain('2024-01-06');
  });

  it('omits headers beyond the bounded header limit and truncates long headers and values', async () => {
    mocked.completeJson.mockResolvedValue(completion);

    const { requestPortfolioColumnMappingSuggestion } = await import('../portfolio-csv-column-mapping-openai');
    const headers = Array.from({ length: 41 }, (_, index) => `H${index + 1}`);
    headers[39] = 'RequiredAfterFive';
    headers[40] = 'OmittedHeader';

    await requestPortfolioColumnMappingSuggestion({
      headers: [...headers, 'x'.repeat(100)],
      rowShapes: [{ cellCount: 3, emptyCellCount: 0, nonEmptyCellCount: 3 }],
      sampleRows: [{ emptyCellCount: 0, hasNumericCells: true, hasTextCells: true, headerCount: 3, nonEmptyCellCount: 3, rowIndex: 0 }],
    });

    const request = mocked.completeJson.mock.calls[0]?.[0];
    const userMessage = request.user as string;
    expect(userMessage).toContain('RequiredAfterFive');
    expect(userMessage).not.toContain('OmittedHeader');
    expect(userMessage).not.toContain('x'.repeat(81));
    expect(userMessage).not.toContain('y'.repeat(81));
    expect(userMessage).not.toContain('z'.repeat(81));
  });

  it('converts non string values safely before prompt', async () => {
    mocked.completeJson.mockResolvedValue(completion);
    const { requestPortfolioColumnMappingSuggestion } = await import('../portfolio-csv-column-mapping-openai');

    await requestPortfolioColumnMappingSuggestion({ headers: ['Date'], rowShapes: [], sampleRows: [{ emptyCellCount: 2, hasNumericCells: true, hasTextCells: false, headerCount: 1, nonEmptyCellCount: 1, rowIndex: 0 }] });

    const userMessage = String(mocked.completeJson.mock.calls[0]?.[0].user);
    expect(userMessage).not.toContain('12345');
  });

  it('bounds raw rows and truncates raw row cells', async () => {
    const { sanitizePortfolioColumnMappingPromptInput } = await import('../portfolio-csv-column-mapping-openai');

    const output = sanitizePortfolioColumnMappingPromptInput({
      headers: Array.from({ length: 10 }, (_, index) => `H${index + 1}`),
      rowShapes: Array.from({ length: 20 }, (_, index) => ({ cellCount: 45, emptyCellCount: index, nonEmptyCellCount: 45 - index })),
      sampleRows: Array.from({ length: 7 }, (_, index) => ({ emptyCellCount: 0, hasNumericCells: true, hasTextCells: true, headerCount: 10, nonEmptyCellCount: 2, rowIndex: index })),
    });

    expect(output.rowShapes).toHaveLength(12);
    expect(output.rowShapes[0]).toMatchObject({ cellCount: 45 });
    expect(output.headers).toHaveLength(10);
    expect(output.sampleRows).toHaveLength(5);
  });

  it('does not include raw row values in the prompt', async () => {
    mocked.completeJson.mockResolvedValue(completion);

    const { requestPortfolioColumnMappingSuggestion } = await import('../portfolio-csv-column-mapping-openai');

    await requestPortfolioColumnMappingSuggestion({ headers: ['Date'], rowShapes: [{ cellCount: 2, emptyCellCount: 0, nonEmptyCellCount: 2 }], sampleRows: [{ emptyCellCount: 0, hasNumericCells: true, hasTextCells: true, headerCount: 1, nonEmptyCellCount: 1, rowIndex: 0 }] });

    const userMessage = String(mocked.completeJson.mock.calls[0]?.[0].user);
    expect(userMessage).not.toContain('Header');
    expect(userMessage).not.toContain('Value');
  });

  it('rejects an empty and an invalid answer', async () => {
    const { AiCompletionError } = await import('@service/ai/complete-json');
    const { requestPortfolioColumnMappingSuggestion } = await import('../portfolio-csv-column-mapping-openai');

    mocked.completeJson.mockRejectedValueOnce(new AiCompletionError('No object generated', { empty: true }));
    await expect(requestPortfolioColumnMappingSuggestion({ headers: ['A'], rowShapes: [], sampleRows: [] })).rejects.toThrow('portfolio column mapping response missing');

    mocked.completeJson.mockResolvedValueOnce({ object: { ...suggestion, extra: true }, tokens: { completionTokens: 0, promptTokens: 0, totalTokens: 0 } });
    await expect(requestPortfolioColumnMappingSuggestion({ headers: ['A'], rowShapes: [], sampleRows: [] })).rejects.toThrow('portfolio column mapping invalid response');
  });
});
