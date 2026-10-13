import { generateInternalFinancialTransactionId } from '../../../entities/financial-transaction/generate-internal-id';
import {
  FinancialTransactionType,
  type FinancialTransactionsParserResult,
} from './types';

const trading212Parser = (
  data: string[][]
): FinancialTransactionsParserResult => {
  return data.map((row) => {
    const datetime = row[1]!;
    const [date, time] = datetime.split(' ');
    const [hours, minutes, seconds] = time!.split(':').map(Number);
    const [year, month, day] = date!.split('-').map(Number);
    const transactionDate = new Date(
      year!,
      month! - 1,
      day,
      hours,
      minutes,
      seconds
    );
    let financialTransactionType: FinancialTransactionType | undefined =
      undefined;
    switch (row[0]) {
      case 'Market buy':
        financialTransactionType = FinancialTransactionType.BUY;
        break;
      case 'Market sell':
        financialTransactionType = FinancialTransactionType.SELL;
        break;
      case 'Dividend (Return of capital)':
      case 'Dividend (Ordinary)':
        financialTransactionType = FinancialTransactionType.DIVIDEND;
        break;
      case 'Deposit':
        financialTransactionType = FinancialTransactionType.DEPOSIT;
        break;
      case 'Withdrawal':
        financialTransactionType = FinancialTransactionType.WITHDRAWAL;
        break;
      default:
        break;
    }
    const isin = row[2];
    const exchange = undefined;
    const quantityParsed = Number.parseFloat(row[5]!);
    let currency = row[7] !== '' ? row[7]! : 'USD'; // Withdwalls are in USD, but dont have a currency in the CSV
    let totalPrice = Number.parseFloat(row[10]!);
    let unitPrice =
      financialTransactionType === FinancialTransactionType.DEPOSIT ||
      financialTransactionType === FinancialTransactionType.WITHDRAWAL
        ? totalPrice
        : Number.parseFloat(row[6]!);
    if (currency === 'GBX') {
      currency = 'GBP';
      unitPrice = unitPrice / 100;
      totalPrice = totalPrice / 100;
    }
    const exchangeRate =
      financialTransactionType !== FinancialTransactionType.DEPOSIT &&
      financialTransactionType !== FinancialTransactionType.WITHDRAWAL &&
      row[8] !== 'Not available'
        ? Number.parseFloat(row[8]!)
        : undefined;
    const totalLocalPrice = exchangeRate
      ? Number.parseFloat(row[10]!) / exchangeRate
      : undefined;
    const assetName =
      financialTransactionType === FinancialTransactionType.DEPOSIT ||
      financialTransactionType === FinancialTransactionType.WITHDRAWAL
        ? 'USD'
        : row[4]!;
    const assetSymbol =
      financialTransactionType === FinancialTransactionType.DEPOSIT ||
      financialTransactionType === FinancialTransactionType.WITHDRAWAL
        ? 'CURRENCY_USD'
        : row[3]!;
    const quantity =
      financialTransactionType === FinancialTransactionType.DEPOSIT ||
      financialTransactionType === FinancialTransactionType.WITHDRAWAL
        ? 1
        : financialTransactionType === FinancialTransactionType.BUY ||
          financialTransactionType === FinancialTransactionType.DIVIDEND
        ? quantityParsed
        : -1 * quantityParsed;
    const externalTransactionId = row[14];
    const internalTransactionId = generateInternalFinancialTransactionId(
      transactionDate,
      assetSymbol,
      totalPrice,
      externalTransactionId
    );
    const feeAmount = row[46] ? Number.parseFloat(row[46]) : undefined;
    const feeCurrency = feeAmount !== undefined ? 'USD' : undefined;
    return {
      transactionDate,
      assetName,
      brokerAssetName: assetName,
      brokerTicker: row[3]!,
      isin: isin || undefined,
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

export default trading212Parser;
