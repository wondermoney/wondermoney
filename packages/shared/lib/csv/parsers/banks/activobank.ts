import Big from 'big.js';
import { extractDataFromTransactionDescription } from '../../../entities/transactions/extract-description';
import { type TransactionsParserResult, TransactionStatus } from './types';
import { generateInternalTransactionId } from '../../../entities/transactions/generate-internal-id';

export type ActivoBankTransaction = [Date, Date, string, number, number];
// Date in format dd/mm/yyyy

const START_ROW = 8;
const END_ROW = undefined;

const activoBankParser = (
  data: ActivoBankTransaction[]
): TransactionsParserResult => {
  return data.slice(START_ROW, END_ROW).map((t) => {
    const descriptionDirty = t[2];
    const { merchant, type } = extractDataFromTransactionDescription(
      'activobank',
      descriptionDirty
    );
    const transactionDate = t[0];
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

export default activoBankParser;
