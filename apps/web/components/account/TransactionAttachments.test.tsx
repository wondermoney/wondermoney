// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

import commonMessages from "../../messages/en/common.json";
import transactionsMessages from "../../messages/en/transactions.json";
import { TransactionAttachments } from "./TransactionAttachments";

const attachments = vi.hoisted(() => ({
  deleteAsync: vi.fn(),
  data: [] as {
    contentType: string;
    createdAt: string;
    fileName: string;
    sizeBytes: number;
    transactionAttachmentKey: number;
    url: string;
  }[],
  uploadAsync: vi.fn(),
}));

const configs = vi.hoisted(() => ({ fileStorage: true }));

vi.mock("@/lib/api/account/useTransactionAttachments", () => ({
  TRANSACTION_ATTACHMENT_MAX_FILES: 10,
  TRANSACTION_ATTACHMENT_MAX_SIZE_BYTES: 10 * 1024 * 1024,
  useDeleteTransactionAttachment: () => ({ mutateAsync: attachments.deleteAsync }),
  useTransactionAttachments: () => ({ data: attachments.data }),
  useUploadTransactionAttachment: () => ({ mutateAsync: attachments.uploadAsync }),
}));

vi.mock("@/lib/api/configs/useConfigs", () => ({
  default: () => ({ data: { fileStorage: configs.fileStorage } }),
}));

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});
afterEach(cleanup);
beforeEach(() => {
  attachments.data = [];
  attachments.deleteAsync.mockReset();
  configs.fileStorage = true;
});

function renderSection() {
  return render(
    <NextIntlClientProvider
      locale="en"
      messages={{ ...commonMessages, ...transactionsMessages }}
    >
      <TransactionAttachments transactionKey={7} />
    </NextIntlClientProvider>,
  );
}

describe("transaction attachments", () => {
  test("shows a drop zone and the limits when storage is configured", () => {
    renderSection();

    expect(screen.getByText("Attachments")).toBeTruthy();
    expect(
      screen.getByText("Drag files here, or click to choose"),
    ).toBeTruthy();
  });

  test("is hidden entirely when the server has no file storage", () => {
    configs.fileStorage = false;

    renderSection();

    expect(screen.queryByText("Attachments")).toBeNull();
  });

  test("shows a thumbnail per image and a PDF icon for a document", () => {
    attachments.data = [
      {
        contentType: "image/png",
        createdAt: "2026-07-20T10:00:00.000Z",
        fileName: "receipt.png",
        sizeBytes: 2048,
        transactionAttachmentKey: 1,
        url: "https://storage.test/receipt.png",
      },
      {
        contentType: "application/pdf",
        createdAt: "2026-07-20T10:00:00.000Z",
        fileName: "invoice.pdf",
        sizeBytes: 4096,
        transactionAttachmentKey: 2,
        url: "https://storage.test/invoice.pdf",
      },
    ];

    renderSection();

    expect(screen.getByAltText("receipt.png")).toBeTruthy();
    expect(screen.getByText("invoice.pdf")).toBeTruthy();
    expect(screen.getByTitle("invoice.pdf")).toBeTruthy();
  });

  test("deletes the attachment the person removes", () => {
    attachments.data = [
      {
        contentType: "image/png",
        createdAt: "2026-07-20T10:00:00.000Z",
        fileName: "receipt.png",
        sizeBytes: 2048,
        transactionAttachmentKey: 42,
        url: "https://storage.test/receipt.png",
      },
    ];

    renderSection();

    fireEvent.click(screen.getByRole("button", { name: "Delete receipt.png" }));

    expect(attachments.deleteAsync).toHaveBeenCalledWith(42);
  });
});
