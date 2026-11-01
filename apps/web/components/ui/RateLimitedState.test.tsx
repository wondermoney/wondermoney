// @vitest-environment jsdom
import assert from "node:assert/strict";

import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";

import { RATE_LIMITED_ERROR_CODE } from "@/lib/api/rate-limit";

import enMessages from "../../messages/en/common.json";
import esMessages from "../../messages/es/common.json";
import ptMessages from "../../messages/pt/common.json";
import DataLoadError from "./DataLoadError";
import { RateLimitedState } from "./RateLimitedState";

// Static markup is the first paint: effects have not run, so the countdown
// must already be right and the live region must be committed empty.

const catalogs = { en: enMessages, pt: ptMessages, es: esMessages } as const;
type Locale = keyof typeof catalogs;

function rateLimitedError(retryAfterSeconds = 45) {
  return {
    response: {
      status: 429,
      data: { code: RATE_LIMITED_ERROR_CODE, family: "read" },
      headers: { "retry-after": String(retryAfterSeconds) },
    },
  };
}

function renderIn(locale: Locale, node: ReactNode) {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={catalogs[locale]}>
      {node}
    </NextIntlClientProvider>,
  );
}

const seconds = (template: string, value: number) =>
  template.replace("{seconds}", String(value));

for (const locale of Object.keys(catalogs) as Locale[]) {
  test(`a 429 renders a calm, translated wait with the Retry-After countdown (${locale})`, () => {
    const messages = catalogs[locale];
    const markup = renderIn(
      locale,
      <RateLimitedState error={rateLimitedError(45)} onRetry={() => {}} />,
    );

    assert.ok(markup.includes(messages["rate-limited-title"]));
    assert.ok(
      markup.includes(seconds(messages["rate-limited-retrying-in"], 45)),
      markup,
    );
    assert.ok(
      !markup.includes('role="alert"'),
      "being throttled is not announced as an error",
    );
    assert.ok(markup.includes('role="status"'));
  });
}

test("the ticking countdown is hidden from assistive tech; the status line is not", () => {
  const markup = renderIn(
    "en",
    <RateLimitedState error={rateLimitedError(45)} onRetry={() => {}} />,
  );
  const document = new DOMParser().parseFromString(markup, "text/html");
  const countdownText = seconds(enMessages["rate-limited-retrying-in"], 45);

  const countdown = [...document.querySelectorAll("*")].find(
    (element) =>
      element.textContent?.trim() === countdownText &&
      element.children.length === 0,
  );
  assert.ok(countdown, "the countdown is rendered");
  assert.ok(
    countdown.closest('[aria-hidden="true"]'),
    "the countdown is aria-hidden",
  );

  const status = document.querySelector('[role="status"]');
  assert.ok(status);
  assert.equal(status.closest('[aria-hidden="true"]'), null);
  assert.equal(
    status.textContent,
    "",
    "the live region is committed empty, then filled",
  );
});

test("a 429 inside a data panel shows the calm state, not a failed load", () => {
  const markup = renderIn(
    "en",
    <DataLoadError error={rateLimitedError(20)} onRetry={() => {}} />,
  );
  assert.ok(markup.includes(enMessages["rate-limited-title"]));
  assert.ok(!markup.includes(enMessages["error-loading-data"]));
});

test("a real failure, or no error at all, still renders the error state", () => {
  for (const error of [{ response: { status: 500 } }, undefined]) {
    const markup = renderIn(
      "en",
      <DataLoadError error={error} onRetry={() => {}} />,
    );
    assert.ok(markup.includes(enMessages["error-loading-data"]));
    assert.ok(!markup.includes(enMessages["rate-limited-title"]));
  }
});

test("without a retry handler the state says when it is available, not that it will retry", () => {
  const markup = renderIn(
    "en",
    <RateLimitedState error={rateLimitedError(30)} />,
  );
  assert.ok(
    markup.includes(seconds(enMessages["rate-limited-available-in"], 30)),
  );
  assert.ok(
    !markup.includes(seconds(enMessages["rate-limited-retrying-in"], 30)),
  );
});

test("a 429 without Retry-After still counts down from the default window", () => {
  const markup = renderIn(
    "en",
    <RateLimitedState
      error={{ response: { status: 429, data: {}, headers: {} } }}
      onRetry={() => {}}
    />,
  );
  assert.ok(
    markup.includes(seconds(enMessages["rate-limited-retrying-in"], 30)),
    markup,
  );
});
