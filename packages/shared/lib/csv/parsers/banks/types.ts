import type { ActivoBankTransaction } from './activobank';
import type { BankinterTransaction } from './bankinter';
import type { MillenniumBcpTransaction } from './bcp';
import type { BpiTransaction } from './bpi';
import type { MontepioTransaction } from './montepio';

export enum TransactionStatus {
  BOOKED = 'BOOKED',
}

export enum TransactionTypes {
  card_payment = 'CARD_PAYMENT',
  transfer_out = 'TRANSFER',
  transfer_in = 'TRANSFER',
  payment_auto = 'PAYMENT',
  payment = 'PAYMENT',
  fees = 'FEES',
  deposit = 'DEPOSIT',
  withdrawal = 'ATM',
  loan = 'LOAN',
  revert = 'REVERT',
}

export const SUPPORTED_BANKS_CSV_IMPORT = [
  'montepio',
  'caixa economica montepio geral',
  'bcp',
  'millennium bcp',
  'bankinter',
  'bpi',
  'banco bpi',
  'activobank',
  'banco activobank',
] as const;
export type SupportedBanks = (typeof SUPPORTED_BANKS_CSV_IMPORT)[number];

export type BankTransactionTypes =
  | ActivoBankTransaction[]
  | MillenniumBcpTransaction[]
  | BpiTransaction[]
  | BankinterTransaction[]
  | MontepioTransaction[];

export interface Transaction {
  transactionDate: Date;
  transactionType: string;
  transactionMerchant: string;
  originalAmount: Big;
  originalCurrency: string;
  settlementAmount: Big;
  settlementCurrency: string;
  transactionStatus: string;
  balance?: Big;
  descriptionDirty: string;
  internalTransactionId: string;
}

export type TransactionsParserResult = Array<Transaction>;
