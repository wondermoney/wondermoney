import { generateInternalFinancialTransactionId } from '../../../entities/financial-transaction/generate-internal-id';
import {
  FinancialTransactionType,
  type FinancialTransactionsParserResult,
} from './types';

type CoinbaseTransactionType =
  | 'Send'
  | 'Receive'
  | 'Buy'
  | 'Sell'
  | 'Learning Reward';

const coinbaseParser = (
  data: string[][]
): FinancialTransactionsParserResult => {
  return data.slice(7).map((r) => {
    const row = r[0]!.split(',');
    const timestamp = row[0]!;
    const quantityParsed = Number.parseFloat(row[3]!);
    let quantity = quantityParsed;
    let financialTransactionType: FinancialTransactionType | undefined =
      undefined;
    switch (row[1] as CoinbaseTransactionType) {
      case 'Buy':
        financialTransactionType = FinancialTransactionType.BUY;
        break;
      case 'Sell':
        financialTransactionType = FinancialTransactionType.SELL;
        quantity = -1 * quantityParsed;
        break;
      case 'Send':
        financialTransactionType = FinancialTransactionType.WITHDRAWAL;
        quantity = -1 * quantityParsed;
        break;
      case 'Receive':
        financialTransactionType = FinancialTransactionType.DEPOSIT;
        break;
      case 'Learning Reward':
        financialTransactionType = FinancialTransactionType.OFFER;
        break;
      default:
        break;
    }
    let totalLocalPrice;
    let totalPrice;
    let feeAmount;
    const unitPrice = Number.parseFloat(row[5]!);
    if (
      financialTransactionType === FinancialTransactionType.SELL ||
      financialTransactionType === FinancialTransactionType.BUY
    ) {
      totalLocalPrice = Number.parseFloat(row[7]!);
      totalPrice = Number.parseFloat(row[7]!);
      feeAmount = Number.parseFloat(row[8]!);
    } else {
      totalLocalPrice = quantityParsed * unitPrice;
      totalPrice = quantityParsed * unitPrice;
      feeAmount = 0;
    }
    const transactionDate = new Date(timestamp);
    const assetName = undefined;
    const assetSymbol = row[2]!;
    const exchange = 'Coinbase';
    const currency = row[4]!;
    const exchangeRate = undefined;
    const feeCurrency = row[4];
    const internalTransactionId = generateInternalFinancialTransactionId(
      transactionDate,
      assetSymbol,
      totalPrice
    );
    const notes = row[10];
    return {
      transactionDate,
      assetName,
      assetSymbol,
      exchange,
      quantity,
      unitPrice,
      currency,
      totalLocalPrice,
      totalPrice,
      exchangeRate,
      financialTransactionType,
      externalTransactionId: undefined,
      internalTransactionId,
      feeAmount,
      feeCurrency,
      notes,
    };
  });
};

export default coinbaseParser;
