import { generateInternalFinancialTransactionId } from '../../../entities/financial-transaction/generate-internal-id';
import {
  FinancialTransactionType,
  type FinancialTransactionsParserResult,
} from './types';
import { optionalNumber, type ParserNumberFormat, requireNumber } from '../number';

// IBKR Flex Query exports always use "." for decimals.
const IBKR_FORMAT: ParserNumberFormat = { decimalSeparator: '.' };

// This CSV has a ; separator in each row. I havent dont anything with it yet, but theres some info there like transaction type "BUi"
const ibkrParser = (data: string[][]): FinancialTransactionsParserResult => {
  return data.map((row, index) => {
    const where = (column: string) => `IBKR row ${index + 1}, ${column}`;
    const date = row[37]!;
    const [year, month, day] = [
      date.slice(0, 4),
      date.slice(4, 6),
      date.slice(6, 8),
    ].map(Number);
    const transactionDate = new Date(year!, month! - 1, day, 0, 0);
    const isin = row[11] || undefined;
    const assetName = row[6];
    const assetSymbol = row[5]!;
    const exchange = row[12];
    const quantityParsed = requireNumber(row[41], IBKR_FORMAT, where('quantity'));
    const unitPrice = requireNumber(row[42], IBKR_FORMAT, where('price'));
    const currency = row[3]!;
    const totalPrice = requireNumber(row[44], IBKR_FORMAT, where('amount'));
    const totalLocalPrice = totalPrice;
    const exchangeRate = undefined;
    const financialTransactionType =
      totalPrice < 0
        ? FinancialTransactionType.BUY
        : FinancialTransactionType.SELL;
    const quantity =
      financialTransactionType === FinancialTransactionType.BUY
        ? quantityParsed
        : -1 * quantityParsed;
    const externalTransactionId = row[25];
    const internalTransactionId = generateInternalFinancialTransactionId(
      transactionDate,
      assetSymbol,
      totalPrice,
      externalTransactionId
    );
    const fee = optionalNumber(row[45], IBKR_FORMAT, where('commission'));
    const feeAmount = fee === undefined ? undefined : Math.abs(fee);
    const feeCurrency = row[52];
    return {
      transactionDate,
      assetName,
      brokerAssetName: assetName || undefined,
      brokerTicker: assetSymbol,
      isin,
      brokerExchange: exchange || undefined,
      assetSymbol,
      exchange,
      quantity,
      unitPrice,
      currency,
      totalLocalPrice,
      totalPrice,
      exchangeRate,
      financialTransactionType,
      externalTransactionId,
      internalTransactionId,
      feeAmount,
      feeCurrency,
    };
  });
};

export default ibkrParser;
