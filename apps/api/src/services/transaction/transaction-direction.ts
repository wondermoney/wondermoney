import { transactionImport } from '@wondermoney/shared';

/**
 * The sign convention and the type↔direction rules live in `@wondermoney/shared`
 * (`lib/import/direction.ts`), beside the import adapters that must sign a file's rows the same way
 * the writer does. Re-exported here so the API keeps one import path for them.
 */
export const INCOMING_TRANSACTION_TYPES = transactionImport.INCOMING_TRANSACTION_TYPES;
export const OUTGOING_TRANSACTION_TYPES = transactionImport.OUTGOING_TRANSACTION_TYPES;
export const signTransactionAmount = transactionImport.signTransactionAmount;
export const transactionTypeForSignedAmount = transactionImport.transactionTypeForSignedAmount;
