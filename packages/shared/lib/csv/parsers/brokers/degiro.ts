import { generateInternalFinancialTransactionId } from '../../../entities/financial-transaction/generate-internal-id';
import {
  FinancialTransactionType,
  type FinancialTransactionsParserResult,
} from './types';
import {
  detectFileDecimalSeparator,
  optionalNumber,
  type ParserNumberFormat,
  requireNumber,
} from '../number';

// Quantity, price, local value, value, exchange rate.
const NUMBER_COLUMNS = [6, 7, 9, 11, 13];

/**
 * DEGIRO writes numbers in the account's interface language ("100,50" in pt, es, nl or de;
 * "100.50" in en). Without an explicit separator, the file's own unambiguous values decide it.
 */
const degiroParser = (
  data: string[][],
  options: ParserNumberFormat = {}
): FinancialTransactionsParserResult => {
  const format: ParserNumberFormat = {
    decimalSeparator:
      options.decimalSeparator ?? detectFileDecimalSeparator(data, NUMBER_COLUMNS),
  };
  return data.map((row, index) => {
    const where = (column: string) => `DEGIRO row ${index + 1}, ${column}`;
    const date = row[0]!;
    const [day, month, year] = date.split('-').map(Number);
    const time = row[1]!;
    const [hours, minutes] = time.split(':').map(Number);
    const transactionDate = new Date(year!, month! - 1, day, hours, minutes);
    const assetName = row[2]!;
    const assetSymbol = row[3]!;
    const isin = assetSymbol;
    const exchange1 = row[4]!;
    const exchange2 = row[5]!;
    const unitPrice = requireNumber(row[7], format, where('price'));
    const currency = row[8]!;
    const totalLocalPrice = requireNumber(row[9], format, where('local value'));
    const totalPrice = requireNumber(row[11], format, where('value'));
    const exchangeRate = optionalNumber(row[13], format, where('exchange rate'));
    const financialTransactionType =
      totalPrice < 0
        ? FinancialTransactionType.BUY
        : FinancialTransactionType.SELL;
    const quantityParsed = requireNumber(row[6], format, where('quantity'));
    const quantity =
      financialTransactionType === FinancialTransactionType.BUY
        ? quantityParsed
        : -1 * quantityParsed;
    const externalTransactionId = row[18];
    const internalTransactionId = generateInternalFinancialTransactionId(
      transactionDate,
      assetSymbol,
      totalPrice,
      externalTransactionId
    );
    return {
      transactionDate,
      assetName,
      brokerAssetName: assetName,
      brokerTicker: undefined,
      isin,
      brokerExchange: exchange2,
      assetSymbol,
      exchange: exchange2,
      exchangeAlias: exchange1,
      quantity,
      unitPrice,
      currency,
      totalLocalPrice: Math.abs(totalLocalPrice),
      totalPrice: Math.abs(totalPrice),
      exchangeRate,
      financialTransactionType,
      externalTransactionId,
      internalTransactionId,
      feeAmount: undefined,
      feeCurrency: undefined,
    };
  });
};

export default degiroParser;
