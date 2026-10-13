/**
 * RAD-556 — renders the rate-limited state rather than pattern-matching it.
 *
 * The source checks in `rate-limit-ui-regression-checks.ts` can only see that
 * the right attributes are written in the JSX. These render the real markup, in
 * all three locales, and read the outcome back out: that a 429 produces the
 * calm state and a 500 does not, that the countdown carries the parsed
 * `Retry-After`, and that the ticking number is hidden from assistive tech
 * while the one announced line is not.
 *
 * Effects do not run under `renderToStaticMarkup`, which is exactly the first
 * paint being asserted: the countdown is already correct, and the live region
 * is committed empty before it is filled.
 */
import assert from "node:assert/strict";

import { NextIntlClientProvider } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";

import DataLoadError from "../components/ui/DataLoadError";
import { RateLimitedState } from "../components/ui/RateLimitedState";
import { RATE_LIMITED_ERROR_CODE } from "../lib/api/rate-limit";

import enMessages from "../messages/en/common.json";
import esMessages from "../messages/es/common.json";
import ptMessages from "../messages/pt/common.json";

const locales = {
  en: enMessages,
  pt: ptMessages,
  es: esMessages,
} as const;

function rateLimitedError(retryAfterSeconds = 45) {
  return {
    response: {
      status: 429,
      data: { code: RATE_LIMITED_ERROR_CODE, family: "read" },
      headers: { "retry-after": String(retryAfterSeconds) },
    },
  };
}

/**
 * `next-intl` logs an `ENVIRONMENT_FALLBACK` diagnostic when a client provider
 * is rendered outside Next's react-server condition, then falls back to the
 * provider's own messages — which is exactly what this harness wants. The
 * diagnostic is noise here, and only that one is swallowed.
 */
const consoleError = console.error;
console.error = (...args: unknown[]) => {
  if (
    args.some(
      (argument) =>
        (argument as { code?: string } | undefined)?.code ===
          "ENVIRONMENT_FALLBACK" || String(argument).includes("ENVIRONMENT_FALLBACK"),
    )
  ) {
    return;
  }
  consoleError(...args);
};

function render(locale: keyof typeof locales, node: React.ReactNode) {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={locales[locale]}>
      {node}
    </NextIntlClientProvider>,
  );
}

// --- 1. a 429 renders the calm state, in every locale -----------------------

for (const locale of Object.keys(locales) as (keyof typeof locales)[]) {
  const messages = locales[locale];
  const markup = render(
    locale,
    <RateLimitedState error={rateLimitedError(45)} onRetry={() => {}} />,
  );

  assert.ok(
    markup.includes(messages["rate-limited-title"]),
    `${locale}: the calm state should carry the translated title`,
  );

  const expectedCountdown = messages["rate-limited-retrying-in"].replace(
    "{seconds}",
    "45",
  );
  assert.ok(
    markup.includes(expectedCountdown),
    `${locale}: the countdown should read "${expectedCountdown}" from the Retry-After header, got:\n${markup}`,
  );

  assert.ok(
    !markup.includes('role="alert"'),
    `${locale}: being throttled is not an error and must not be announced as one`,
  );
  assert.ok(
    markup.includes('role="status"'),
    `${locale}: the calm state should carry a polite status region`,
  );
}

// --- 2. the countdown is silent; the announcement is not --------------------

const enMarkup = render(
  "en",
  <RateLimitedState error={rateLimitedError(45)} onRetry={() => {}} />,
);

const countdownFragment = enMarkup.slice(
  enMarkup.indexOf("Retrying in 45s") - 200,
  enMarkup.indexOf("Retrying in 45s"),
);
assert.ok(
  countdownFragment.includes('aria-hidden="true"'),
  `the ticking countdown must be aria-hidden, got:\n${countdownFragment}`,
);

const statusIndex = enMarkup.indexOf('role="status"');
assert.ok(statusIndex >= 0, "the live region should be rendered");
assert.ok(
  !enMarkup.slice(statusIndex, statusIndex + 120).includes("aria-hidden"),
  "the announced line must not be hidden from assistive tech",
);
assert.ok(
  /class="sr-only"[^>]*role="status"[^>]*>\s*</.test(enMarkup) ||
    /role="status"[^>]*class="sr-only"[^>]*>\s*</.test(enMarkup),
  "the live region should be committed empty, then filled, so the fill is what gets announced",
);

// --- 3. the widget-level router picks the right state ----------------------

const rateLimitedPanel = render(
  "en",
  <DataLoadError error={rateLimitedError(20)} onRetry={() => {}} />,
);
assert.ok(
  rateLimitedPanel.includes(enMessages["rate-limited-title"]),
  "DataLoadError should degrade a 429 to the calm state",
);
assert.ok(
  !rateLimitedPanel.includes(enMessages["error-loading-data"] as string),
  "DataLoadError must not call a 429 a failed load",
);

const failedPanel = render(
  "en",
  <DataLoadError
    error={{ response: { status: 500 } }}
    onRetry={() => {}}
  />,
);
assert.ok(
  failedPanel.includes(enMessages["error-loading-data"] as string),
  "a real failure should still render the error state",
);
assert.ok(
  !failedPanel.includes(enMessages["rate-limited-title"]),
  "a 500 is not a rate limit",
);

// A panel that passes no error at all keeps today's behaviour.
const legacyPanel = render("en", <DataLoadError onRetry={() => {}} />);
assert.ok(
  legacyPanel.includes(enMessages["error-loading-data"] as string),
  "panels that pass no error should be unchanged",
);

// --- 4. without a retry handler the copy does not promise one --------------

const passiveMarkup = render(
  "en",
  <RateLimitedState error={rateLimitedError(30)} />,
);
assert.ok(
  passiveMarkup.includes(
    enMessages["rate-limited-available-in"].replace("{seconds}", "30"),
  ),
  "with no retry handler the state should say when it is available, not claim it will retry",
);
assert.ok(
  !passiveMarkup.includes("Retrying in"),
  "with no retry handler the state must not promise a retry",
);

// --- 5. a missing Retry-After still produces a usable countdown ------------

const defaultedMarkup = render(
  "en",
  <RateLimitedState
    error={{ response: { status: 429, data: {}, headers: {} } }}
    onRetry={() => {}}
  />,
);
assert.ok(
  defaultedMarkup.includes("Retrying in 30s"),
  "a 429 with no Retry-After should fall back to the default window",
);

console.log("rate limit UI render checks passed");
