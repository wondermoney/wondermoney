import Big from 'big.js';
import { type TransactionsParserResult, TransactionStatus } from './types';
import { extractDataFromTransactionDescription } from '../../../entities/transactions/extract-description';
import { generateInternalTransactionId } from '../../../entities/transactions/generate-internal-id';
import { requireDecimalString } from '../number';

export type MontepioTransaction = [
  Date,
  Date,
  string,
  string | number,
  string | number
];

// Montepio writes amounts as text in the Portuguese format ("1.234,56"), or as numeric cells.
const MONTEPIO_FORMAT = { decimalSeparator: ',' } as const;

const START_ROW = 9;
const END_ROW = undefined;

const montepioParser = (
  data: MontepioTransaction[]
): TransactionsParserResult => {
  return data.slice(START_ROW, END_ROW).map((t, index) => {
    const descriptionDirty = t[2];
    const { merchant, type } = extractDataFromTransactionDescription(
      'montepio',
      descriptionDirty
    );
    const transactionDate = t[0];
    const row = START_ROW + index + 1;
    const amount = new Big(
      requireDecimalString(t[3], MONTEPIO_FORMAT, `Montepio row ${row}, amount`)
    );
    const balance = t[4]
      ? new Big(
          requireDecimalString(t[4], MONTEPIO_FORMAT, `Montepio row ${row}, balance`)
        )
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
