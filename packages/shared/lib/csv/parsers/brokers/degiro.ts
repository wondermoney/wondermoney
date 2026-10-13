import { generateInternalFinancialTransactionId } from '../../../entities/financial-transaction/generate-internal-id';
import {
  FinancialTransactionType,
  type FinancialTransactionsParserResult,
} from './types';

const degiroParser = (data: string[][]): FinancialTransactionsParserResult => {
  return data.map((row) => {
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
    const unitPrice = Number.parseFloat(row[7]!);
    const currency = row[8]!;
    const totalLocalPrice = Number.parseFloat(row[9]!);
    const totalPrice = Number.parseFloat(row[11]!);
    const exchangeRate =
      row[13] !== '' ? Number.parseFloat(row[13]!) : undefined;
    const financialTransactionType =
      totalPrice < 0
        ? FinancialTransactionType.BUY
        : FinancialTransactionType.SELL;
    const quantityParsed = Number.parseFloat(row[6]!);
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
