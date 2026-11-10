import assert from "node:assert/strict";

import type { AxiosAdapter, InternalAxiosRequestConfig } from "axios";
import { afterEach, test } from "vitest";

import {
  createTransactionFormSchema,
  toTransactionRequest,
} from "@/lib/account/transaction-form-schema";

import api from "../../api";
import { buildConfirmTransactionOcrPayload } from "../useConfirmTransactionOcr";
import { buildCreateTransactionPayload } from "../useCreateTransaction";
import { uploadTransactionOcr } from "../useCreateTransactionOcr";

const t = (key: string) => key;

const formInput = {
  accountId: "12",
  description: "",
  settlementAmount: "152,40",
  settlementCurrencyId: "151",
  transactionDate: new Date("2026-10-14T10:00:00.000Z"),
  transactionMerchantId: "[NewMerchant]-Cafe",
  transactionMerchantName: "Cafe",
  transactionTypeId: "1",
};

const submit = (input: Record<string, unknown>, locale = "pt") =>
  toTransactionRequest(createTransactionFormSchema(t, locale).parse(input));

const buildRequest = (input: Record<string, unknown>, locale = "pt") => {
  const { accountId: _accountId, ...request } = submit(input, locale);
  return buildCreateTransactionPayload(request);
};

test("sends an original-currency amount as strings when the switch is on", () => {
  const body = buildRequest({
    ...formInput,
    exchangeRate: "1,2",
    hasOriginalAmount: true,
    originalAmount: "127,00",
    originalCurrencyId: "47",
  });

  assert.equal(body.originalAmount, "127");
  assert.equal(body.originalCurrencyId, "47");
  assert.equal(body.exchangeRate, "1.2");
  assert.equal(body.settlementAmount, "152.4");
});

test("drops the original-currency fields after the switch is turned off", () => {
  const body = buildRequest({
    ...formInput,
    exchangeRate: "1,2",
    hasOriginalAmount: false,
    originalAmount: "127,00",
    originalCurrencyId: "47",
  });

  assert.equal(body.originalAmount, undefined);
  assert.equal(body.originalCurrencyId, undefined);
  assert.equal(body.exchangeRate, undefined);
  assert.equal(body.settlementAmount, "152.4");
});

test("an incomplete original amount does not block the form once the switch is off", () => {
  const result = createTransactionFormSchema(t, "pt").safeParse({
    ...formInput,
    hasOriginalAmount: false,
    originalAmount: "127",
  });

  assert.equal(result.success, true);
});

test("reads amounts in the user's locale", () => {
  assert.equal(
    buildRequest({ ...formInput, settlementAmount: "1.234,56" }, "pt")
      .settlementAmount,
    "1234.56",
  );
  assert.equal(
    buildRequest({ ...formInput, settlementAmount: "1.000" }, "es")
      .settlementAmount,
    "1000",
  );
  assert.equal(
    buildRequest({ ...formInput, settlementAmount: "1.000" }, "en")
      .settlementAmount,
    "1",
  );
  assert.equal(
    buildRequest({ ...formInput, settlementAmount: "1,234.56" }, "en")
      .settlementAmount,
    "1234.56",
  );
});

test("an unreadable or blank amount is a form error, not another number", () => {
  for (const settlementAmount of ["12,,5", "1.2.3", "abc", ""]) {
    const result = createTransactionFormSchema(t, "pt").safeParse({
      ...formInput,
      settlementAmount,
    });
    assert.equal(result.success, false, settlementAmount);
    assert.deepEqual(
      result.error?.issues.map((issue) => issue.message),
      ["invalid-amount"],
    );
  }

  const badRate = createTransactionFormSchema(t, "pt").safeParse({
    ...formInput,
    exchangeRate: "1,2,3",
    hasOriginalAmount: true,
    originalAmount: "127,00",
    originalCurrencyId: "47",
  });
  assert.equal(badRate.success, false);
});

test("a blank optional amount is no amount", () => {
  const body = buildRequest({
    ...formInput,
    exchangeRate: "",
    hasOriginalAmount: true,
    originalAmount: "127,00",
    originalCurrencyId: "47",
  });

  assert.equal(body.originalAmount, "127");
  assert.equal(body.exchangeRate, undefined);
});

test("sends a new merchant by name and an existing one by numeric key", () => {
  const newMerchant = buildRequest(formInput);
  assert.equal(newMerchant.transactionMerchantId, undefined);
  assert.equal(newMerchant.transactionMerchantName, "Cafe");

  const existing = buildRequest({ ...formInput, transactionMerchantId: "88" });
  assert.equal(existing.transactionMerchantId, 88);
});

test("sends a new merchant name without the surrounding whitespace OCR or typing left on it", () => {
  const body = buildRequest({
    ...formInput,
    transactionMerchantId: "[NewMerchant]-  Cafe Central ",
    transactionMerchantName: "  Cafe Central ",
  });

  assert.equal(body.transactionMerchantName, "Cafe Central");
  assert.equal(body.transactionMerchantId, undefined);
});

test("sends the chosen tags with a new transaction", () => {
  const body = buildRequest({ ...formInput, tagIds: [4, 9] });

  assert.deepEqual(body.tagIds, [4, 9]);
});

test("leaves tagIds off the body when no tag is chosen", () => {
  assert.equal("tagIds" in buildRequest(formInput), false);
  assert.equal("tagIds" in buildRequest({ ...formInput, tagIds: [] }), false);
});

test("confirms an OCR import with the chosen category and string amounts", () => {
  const body = buildConfirmTransactionOcrPayload(
    submit({ ...formInput, categoryId: "9" }),
  );

  assert.deepEqual(body.categoryIds, ["9"]);
  assert.equal(body.settlementAmount, "152.4");
  assert.equal(body.originalAmount, undefined);
});

const originalAdapter = api.defaults.adapter;
afterEach(() => {
  api.defaults.adapter = originalAdapter;
});

test("uploads the receipt as multipart form data with the file in the file field", async () => {
  let sent: InternalAxiosRequestConfig | undefined;
  const capture: AxiosAdapter = async (config) => {
    sent = config;
    return {
      config,
      data: {},
      headers: {},
      status: 201,
      statusText: "Created",
    };
  };
  api.defaults.adapter = capture;

  const receipt = new File(
    [new Uint8Array([0x89, 0x50, 0x4e, 0x47])],
    "receipt.png",
    {
      type: "image/png",
    },
  );
  await uploadTransactionOcr(receipt);

  assert.ok(sent);
  assert.equal(sent.url, "/v1/account/transaction/ocr");
  assert.ok(
    sent.data instanceof FormData,
    "the body reaches the adapter as FormData",
  );
  const uploaded = (sent.data as FormData).get("file");
  assert.ok(uploaded instanceof File);
  assert.equal(uploaded.name, "receipt.png");
  assert.match(String(sent.headers.getContentType()), /^multipart\/form-data/);
});
