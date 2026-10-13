import Big from 'big.js';
import { type TransactionsParserResult, TransactionStatus } from './types';
import { extractDataFromTransactionDescription } from '../../../entities/transactions/extract-description';
import { generateInternalTransactionId } from '../../../entities/transactions/generate-internal-id';

export type MontepioTransaction = [
  Date,
  Date,
  string,
  string | number,
  string | number
];

const START_ROW = 9;
const END_ROW = undefined;

const montepioParser = (
  data: MontepioTransaction[]
): TransactionsParserResult => {
  return data.slice(START_ROW, END_ROW).map((t) => {
    const descriptionDirty = t[2];
    const { merchant, type } = extractDataFromTransactionDescription(
      'montepio',
      descriptionDirty
    );
    const transactionDate = t[0];
    const amountStr = t[3].toString().replace('.', '').replace(',', '.');
    const amount = new Big(amountStr);
    const balance = t[4]
      ? new Big(t[4].toString().replace('.', '').replace(',', '.'))
      : undefined;
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
      descriptionDirty: descriptionDirty,
      internalTransactionId,
    };
  });
};

export default montepioParser;
