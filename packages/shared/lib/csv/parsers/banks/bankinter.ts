import Big from 'big.js';
import { type TransactionsParserResult, TransactionStatus } from './types';
import { extractDataFromTransactionDescription } from '../../../entities/transactions/extract-description';
import { generateInternalTransactionId } from '../../../entities/transactions/generate-internal-id';

export type BankinterTransaction = [
  string, // date in format dd-mm-yyyy
  Date,
  string,
  string,
  number,
  string,
  number,
  string,
  string
];

const START_ROW = 8;
const END_ROW = -2;

const bankinterParser = (
  data: BankinterTransaction[]
): TransactionsParserResult => {
  return data.slice(START_ROW, END_ROW).map((t) => {
    const descriptionDirty = t[2];
    const { merchant, type } = extractDataFromTransactionDescription(
      'bankinter',
      descriptionDirty
    );
    const [day, month, year] = t[0]
      .split('-')
      .map((n) => Number.parseInt(n, 10));
    const transactionDate = new Date(year!, month! - 1, day);
    const balance = new Big(t[6]);
    const amount = new Big(t[4]);
    const currency = t[5];
    const internalTransactionId = generateInternalTransactionId(
      transactionDate,
      amount.toNumber()
    );
    return {
      transactionDate,
      transactionType: type,
      transactionMerchant: merchant,
      originalAmount: amount,
      originalCurrency: currency,
      settlementAmount: amount,
      settlementCurrency: currency,
      transactionStatus: TransactionStatus.BOOKED,
      balance,
      descriptionDirty,
      internalTransactionId,
    };
  });
};

export default bankinterParser;
