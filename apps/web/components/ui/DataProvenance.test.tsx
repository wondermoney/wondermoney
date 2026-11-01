// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render } from "@testing-library/react";
import { formatDistanceToNow } from "date-fns";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, test } from "vitest";

import { getDateFnsLocale } from "@/lib/utils/dateFnsLocale";

import { DataProvenance } from "./DataProvenance";

afterEach(cleanup);

function renderIn(locale: string, node: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale={locale} messages={{}}>
      {node}
    </NextIntlClientProvider>,
  );
}

test("renders nothing when there is no valid date and no scope", () => {
  for (const updatedAt of [undefined, null, "not-a-date"]) {
    const { container } = renderIn(
      "en",
      <DataProvenance updatedAt={updatedAt} />,
    );
    assert.equal(container.innerHTML, "");
    cleanup();
  }
});

test("the relative time is written in the reader's language", () => {
  const updatedAt = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const english = formatDistanceToNow(updatedAt, { addSuffix: true });
  const portuguese = formatDistanceToNow(updatedAt, {
    addSuffix: true,
    locale: getDateFnsLocale("pt"),
  });
  assert.notEqual(
    english,
    portuguese,
    "premise: date-fns distinguishes en and pt",
  );

  const { container } = renderIn(
    "pt",
    <DataProvenance updatedAt={updatedAt} />,
  );

  assert.ok(
    container.textContent?.includes(portuguese),
    container.textContent ?? "",
  );
  assert.ok(!container.textContent?.includes(english));
});

test("a refresh time in the future reads as now, never as 'in N years'", () => {
  const future = new Date(Date.now() + 20 * 365 * 24 * 60 * 60 * 1000);
  const { container } = renderIn("en", <DataProvenance updatedAt={future} />);
  const text = container.textContent ?? "";
  assert.ok(!/\bin\b/.test(text), text);
  assert.ok(!/year/.test(text), text);
});
