import assert from "node:assert/strict";

import { test } from "vitest";

import {
  buildTransferEdit,
  decodeTransferDestination,
  encodeTransferDestination,
} from "./transaction-transfer";

const payment = {
  amount: -250,
  transactionType: "PAYMENT",
  transferDestination: null,
};

test("marking an outgoing payment as a transfer sends TRANSFER_OUT and its destination", () => {
  assert.deepEqual(
    buildTransferEdit(payment, {
      transfer: true,
      destination: { type: "portfolio", key: 7 },
    }),
    {
      transactionType: "TRANSFER_OUT",
      transferDestination: { type: "portfolio", key: 7 },
    },
  );
});

test("marking a deposit as a transfer sends TRANSFER_IN and no destination", () => {
  assert.deepEqual(
    buildTransferEdit(
      { amount: 100, transactionType: "DEPOSIT", transferDestination: null },
      { transfer: true, destination: { type: "account", key: 3 } },
    ),
    { transactionType: "TRANSFER_IN" },
  );
});

test("undoing a transfer goes back to the type of its direction", () => {
  assert.deepEqual(
    buildTransferEdit(
      {
        amount: -250,
        transactionType: "TRANSFER_OUT",
        transferDestination: { type: "goal", key: 2 },
      },
      { transfer: false, destination: null },
    ),
    { transactionType: "PAYMENT" },
  );
});

test("an unchanged row sends nothing; a new destination alone is sent alone", () => {
  const transfer = {
    amount: -250,
    transactionType: "TRANSFER_OUT",
    transferDestination: { type: "account" as const, key: 4 },
  };
  assert.deepEqual(
    buildTransferEdit(transfer, {
      transfer: true,
      destination: { type: "account", key: 4 },
    }),
    {},
  );
  assert.deepEqual(
    buildTransferEdit(transfer, { transfer: true, destination: null }),
    { transferDestination: null },
  );
  assert.deepEqual(
    buildTransferEdit(payment, { transfer: false, destination: null }),
    {},
  );
});

test("destinations round-trip through a select value", () => {
  assert.deepEqual(
    decodeTransferDestination(
      encodeTransferDestination({ type: "goal", key: 9 }),
    ),
    { type: "goal", key: 9 },
  );
  assert.equal(encodeTransferDestination(null), "none");
  assert.equal(decodeTransferDestination("none"), null);
  assert.equal(decodeTransferDestination("broker:1"), null);
});
