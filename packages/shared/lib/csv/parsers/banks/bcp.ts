import Big from 'big.js';
import { type TransactionsParserResult, TransactionStatus } from './types';
import { extractDataFromTransactionDescription } from '../../../entities/transactions/extract-description';
import { generateInternalTransactionId } from '../../../entities/transactions/generate-internal-id';

export type MillenniumBcpTransaction = [
  Date, // date in format dd/mm/yyyy
  Date, // date in format dd/mm/yyyy
  string,
  number,
  string,
  number
];

const START_ROW = 13;
const END_ROW = -1;

const millenniumBcpParser = (
  data: MillenniumBcpTransaction[]
): TransactionsParserResult => {
  return data.slice(START_ROW, END_ROW).map((t) => {
    const descriptionDirty = t[2];
    const { merchant, type } = extractDataFromTransactionDescription(
      'bcp',
      t[2]
    );
    const transactionDate = t[0];
    const amount = new Big(t[3]);
    const balance = new Big(t[5]);
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

export default millenniumBcpParser;
