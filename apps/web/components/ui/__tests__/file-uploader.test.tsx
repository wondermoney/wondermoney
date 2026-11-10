// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, beforeEach, test, vi } from "vitest";

import { FileUploader } from "@/components/ui/FileUploader";

import messages from "../../../messages/en/common.json";

const mocks = vi.hoisted(() => ({
  toastError: vi.fn(),
  toastPromise: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { error: mocks.toastError, promise: mocks.toastPromise },
}));

beforeAll(() => {
  URL.createObjectURL ??= () => "blob:preview";
  URL.revokeObjectURL ??= () => {};
});
beforeEach(() => {
  mocks.toastError.mockClear();
  mocks.toastPromise.mockClear();
});
afterEach(cleanup);

const CSV = { "text/csv": [".csv"] };

function renderUploader(props: Partial<React.ComponentProps<typeof FileUploader>>) {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <FileUploader accept={CSV} maxFileCount={1} {...props} />
    </NextIntlClientProvider>,
  );
  const input = document.querySelector("input[type=file]");
  assert.ok(input instanceof HTMLInputElement);
  return input.parentElement as HTMLElement;
}

function drop(target: HTMLElement, files: File[]) {
  fireEvent.drop(target, {
    dataTransfer: {
      files,
      items: files.map((file) => ({ kind: "file", type: file.type, getAsFile: () => file })),
      types: ["Files"],
    },
  });
}

const csv = (name: string) => new File(["date;amount\n"], name, { type: "text/csv" });

test("a drop over the file limit adds no file and says there are too many", async () => {
  const onValueChange = vi.fn();
  const onUpload = vi.fn(async () => {});
  const root = renderUploader({ onValueChange, onUpload });

  drop(root, [csv("january.csv"), csv("february.csv")]);

  await waitFor(() => assert.equal(mocks.toastError.mock.calls.length, 1));
  assert.equal(onValueChange.mock.calls.length, 0);
  assert.equal(onUpload.mock.calls.length, 0);
  assert.equal(screen.queryByText("january.csv"), null);
});

test("a drop within the file limit adds the file and uploads it", async () => {
  const onUpload = vi.fn(async () => {});
  const root = renderUploader({ onUpload });

  drop(root, [csv("january.csv")]);

  await screen.findByText("january.csv");
  assert.equal(mocks.toastError.mock.calls.length, 0);
  assert.equal(mocks.toastPromise.mock.calls.length, 1);
});
