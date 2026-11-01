// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, test } from "vitest";

import {
  getAmountClassName,
  getDeltaClassName,
  getThresholdClassName,
} from "@/lib/utils/formatCurrency";

import { Amount, type AmountProps } from "./Amount";

afterEach(cleanup);

function renderAmount(props: AmountProps, locale = "en") {
  const { container } = render(
    <NextIntlClientProvider locale={locale} messages={{}}>
      <Amount {...props} />
    </NextIntlClientProvider>,
  );
  return container.firstElementChild as HTMLElement;
}

test("a missing value renders as an em-dash, never as a zero", () => {
  for (const value of [null, undefined, Number.NaN]) {
    const element = renderAmount({ value });
    assert.equal(element.textContent, "—");
    assert.ok(!/0/.test(element.textContent ?? ""));
    cleanup();
  }
});

test("a real zero still renders as a measurement", () => {
  assert.match(renderAmount({ value: 0 }).textContent ?? "", /0/);
});

test("the currency symbol sits where the reader's locale puts it", () => {
  const en =
    renderAmount({ value: 11250.5, currency: "EUR" }, "en").textContent ?? "";
  cleanup();
  const pt =
    renderAmount({ value: 11250.5, currency: "EUR" }, "pt").textContent ?? "";

  assert.ok(
    en.indexOf("€") < en.search(/\d/),
    `en should prefix the symbol: ${en}`,
  );
  assert.ok(
    pt.indexOf("€") > pt.search(/\d/),
    `pt should suffix the symbol: ${pt}`,
  );
});

test("the currency symbol is rendered as a separately styled, muted part", () => {
  const element = renderAmount({ value: 10, currency: "EUR" });
  const symbol = [...element.querySelectorAll("span")].find(
    (span) => span.textContent === "€",
  );
  assert.ok(symbol, "the symbol has its own element");
  assert.ok(symbol.classList.contains("text-muted-foreground"));
});

test("a threshold amount is marked only once it goes negative", () => {
  assert.ok(
    renderAmount({ value: -5, tone: "threshold" }).classList.contains(
      "text-destructive-text",
    ),
  );
  cleanup();
  assert.ok(
    !renderAmount({ value: 5, tone: "threshold" }).classList.contains(
      "text-destructive-text",
    ),
  );
});

test("a level is never coloured by its sign", () => {
  const negative = renderAmount({ value: -5 });
  assert.ok(!negative.classList.contains("text-destructive-text"));
  assert.ok(!negative.classList.contains("text-success-text"));
  assert.ok(getAmountClassName().split(" ").includes("text-foreground"));
});

test("a delta is coloured by its direction", () => {
  assert.ok(getDeltaClassName(-1).includes("text-destructive-text"));
  assert.ok(getDeltaClassName(1).includes("text-success-text"));
  assert.ok(!/destructive|success/.test(getDeltaClassName(0)));
});

test("a threshold marks only the breach, with the accessible destructive text token", () => {
  assert.ok(
    getThresholdClassName(-0.01).split(" ").includes("text-destructive-text"),
  );
  assert.ok(!getThresholdClassName(0).includes("destructive"));
  assert.ok(!getThresholdClassName(100).includes("destructive"));
});

test("a negative amount carries a true minus sign in every locale", () => {
  for (const locale of ["en", "pt", "es"]) {
    const text = renderAmount({ value: -221.67 }, locale).textContent ?? "";
    assert.ok(text.includes("−"), `${locale}: ${text}`);
    assert.ok(!text.includes("-"), `${locale}: ${text}`);
    cleanup();
  }
});
