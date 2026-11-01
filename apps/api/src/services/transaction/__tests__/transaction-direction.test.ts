import { describe, expect, it } from 'vitest';

import { signTransactionAmount, transactionTypeForSignedAmount } from '@service/transaction/transaction-direction';

describe('signTransactionAmount', () => {
  it.each([
    // Outgoing types are stored negative, however the caller signed the amount.
    { amount: 42.5, expected: -42.5, typeName: 'CARD_PAYMENT' },
    { amount: -42.5, expected: -42.5, typeName: 'CARD_PAYMENT' },
    { amount: 900, expected: -900, typeName: 'PAYMENT' },
    { amount: -900, expected: -900, typeName: 'payment' },
    { amount: -200, expected: -200, typeName: 'LOAN' },
    { amount: 20, expected: -20, typeName: 'ATM' },
    { amount: -3, expected: -3, typeName: 'FEE' },
    { amount: 3, expected: -3, typeName: 'fees' },
    { amount: -15, expected: -15, typeName: 'TRANSFER_OUT' },
    // Incoming types are stored positive, however the caller signed the amount.
    { amount: 1500, expected: 1500, typeName: 'DEPOSIT' },
    { amount: -1500, expected: 1500, typeName: 'DEPOSIT' },
    { amount: -15, expected: 15, typeName: 'TRANSFER_IN' },
    { amount: -9.99, expected: 9.99, typeName: 'CARD_REFUND' },
    { amount: -1, expected: 1, typeName: 'CASHBACK' },
    { amount: -1, expected: 1, typeName: 'REWARD' },
    { amount: -50, expected: 50, typeName: 'TOPUP' },
    // Types that carry no direction keep the caller's sign.
    { amount: -30, expected: -30, typeName: 'EXCHANGE' },
    { amount: 30, expected: 30, typeName: 'EXCHANGE' },
    { amount: -12, expected: -12, typeName: 'REVERT' },
    { amount: 12, expected: 12, typeName: 'REVERT' },
  ])('stores $amount as $typeName as $expected', ({ amount, expected, typeName }) => {
    expect(signTransactionAmount(amount, typeName)).toBe(expected);
  });

  it('keeps zero as zero for every direction', () => {
    expect(Object.is(signTransactionAmount(0, 'CARD_PAYMENT'), 0)).toBe(true);
    expect(Object.is(signTransactionAmount(-0, 'DEPOSIT'), 0)).toBe(true);
  });
});

describe('transactionTypeForSignedAmount', () => {
  it.each([
    // A guess that agrees with the sign, or has no direction, is kept.
    { amount: -42.5, expected: 'CARD_PAYMENT', guess: 'CARD_PAYMENT' },
    { amount: 1500, expected: 'DEPOSIT', guess: 'DEPOSIT' },
    { amount: -12, expected: 'REVERT', guess: 'REVERT' },
    { amount: 12, expected: 'REVERT', guess: 'REVERT' },
    { amount: 30, expected: 'EXCHANGE', guess: 'EXCHANGE' },
    { amount: 0, expected: 'PAYMENT', guess: 'PAYMENT' },
    // Money in under an outgoing guess becomes the matching incoming type, or a deposit.
    { amount: 1500, expected: 'DEPOSIT', guess: 'PAYMENT' },
    { amount: 20, expected: 'CARD_REFUND', guess: 'CARD_PAYMENT' },
    { amount: 50, expected: 'DEPOSIT', guess: 'ATM' },
    { amount: 3, expected: 'DEPOSIT', guess: 'FEE' },
    { amount: 5000, expected: 'DEPOSIT', guess: 'LOAN' },
    // Money out under an incoming guess becomes the matching outgoing type, or a payment.
    { amount: -9.99, expected: 'CARD_PAYMENT', guess: 'CARD_REFUND' },
    { amount: -50, expected: 'PAYMENT', guess: 'DEPOSIT' },
    { amount: -10, expected: 'PAYMENT', guess: 'TOPUP' },
    // A guessed transfer is money in or out; only transfer matching makes it a transfer.
    { amount: 1500, expected: 'DEPOSIT', guess: 'TRANSFER' },
    { amount: -700, expected: 'PAYMENT', guess: 'TRANSFER' },
    { amount: 15, expected: 'DEPOSIT', guess: 'TRANSFER_IN' },
    { amount: 15, expected: 'DEPOSIT', guess: 'TRANSFER_OUT' },
    { amount: -15, expected: 'PAYMENT', guess: 'TRANSFER_IN' },
    { amount: -15, expected: 'PAYMENT', guess: 'TRANSFER_OUT' },
  ])('labels $amount guessed as $guess as $expected', ({ amount, expected, guess }) => {
    const type = transactionTypeForSignedAmount(guess, amount);
    expect(type).toBe(expected);
    // Whatever the label, signing by it reproduces the amount the source stated.
    expect(signTransactionAmount(amount, type)).toBe(amount);
  });
});
