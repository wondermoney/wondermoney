import Big from 'big.js';
import { type TransactionsParserResult, TransactionStatus } from './types';
import { extractDataFromTransactionDescription } from '../../../entities/transactions/extract-description';
import { generateInternalTransactionId } from '../../../entities/transactions/generate-internal-id';

export type BpiTransaction = [string, string, string, number, number];
// first string is date in format dd-mm-yyyy
// second string is date in format dd-mm-yyyy, but mostly empty string

const START_ROW = 13;
const END_ROW = -3;

const bpiParser = (data: BpiTransaction[]): TransactionsParserResult => {
  return data.slice(START_ROW, END_ROW).map((t) => {
    const descriptionDirty = t[2];
    const { merchant, type } = extractDataFromTransactionDescription(
      'bpi',
      descriptionDirty
    );
    const [day, month, year] = t[0]
      .split('-')
      .map((x) => Number.parseInt(x, 10));
    const transactionDate = new Date(year!, month! - 1, day);
    const amount = new Big(t[3]);
    const balance = new Big(t[4]);
    const currency = 'EUR';
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

export default bpiParser;
