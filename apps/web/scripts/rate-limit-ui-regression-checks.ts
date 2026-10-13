/**
 * RAD-556 — a 429 is a wait, not a fault.
 *
 * The web app used to treat "too many requests" like any other failure and
 * render the full-page error screen. That screen was wrong twice over: it
 * implied something was broken when nothing was, and it gave no sign that
 * waiting resolves it.
 *
 * The behaviour these checks lock in:
 *   - detection lives in one shared module and is wired into both axios
 *     clients and the React Query policy;
 *   - the calm state is calm — no `role="alert"`, no support link, no status
 *     chip, and a countdown that assistive tech is not made to read aloud
 *     every second;
 *   - a fan-out page degrades per widget, so one shared 429 does not turn six
 *     report cards into six error screens;
 *   - the copy stays translated in all three locales.
 *
 * The runtime behaviour (parsing, backoff, stampede control) is covered by
 * `lib/api/rate-limit.test.ts`, `lib/api/rate-limit-coordinator.test.ts` and
 * `lib/query/retry-policy.test.ts`, which this script runs alongside.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function assert(condition: unknown, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

function read(relativePath: string) {
  return readFileSync(join(root, relativePath), "utf8");
}

/**
 * Several checks below scan for markup that must not be there, and the
 * comments in those files legitimately name the forbidden thing.
 */
function stripComments(source: string) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

// 1. Detection is shared, not duplicated per call site.

const rateLimitModule = read("lib/api/rate-limit.ts");

for (const exported of [
  "getRateLimitInfo",
  "isRateLimitError",
  "attachRateLimitInfo",
  "getSecondsRemaining",
  "RATE_LIMITED_ERROR_CODE",
]) {
  assert(
    new RegExp(`export (?:function|const) ${exported}\\b`).test(rateLimitModule),
    `lib/api/rate-limit.ts should export ${exported} — detection stays in one place`,
  );
}

assert(
  /status !== 429 && code !== RATE_LIMITED_ERROR_CODE/.test(rateLimitModule),
  "lib/api/rate-limit.ts should detect both the 429 status and the RATE_LIMITED body code",
);

// 2. Both axios clients normalise the envelope at response time.

for (const client of ["lib/api/api.ts", "lib/api/api-server.ts"]) {
  assert(
    /attachRateLimitInfo\(error\)/.test(read(client)),
    `${client} should normalise a rate-limited response in its interceptor`,
  );
}

// 3. React Query owns the retry policy, and it honours Retry-After.

const retryPolicy = read("lib/query/retry-policy.ts");
assert(
  /getRateLimitInfo\(error\) !== null\) return false/.test(retryPolicy),
  "lib/query/retry-policy.ts should stop React Query retrying a 429 behind a spinner",
);
assert(
  /coordinator\.getRetryDelayMs\(rateLimit\)/.test(retryPolicy),
  "lib/query/retry-policy.ts should take its rate-limit delay from the coordinator, not a fixed backoff",
);

const queryClient = read("lib/query/query-client.ts");
assert(
  /retry: shouldRetryQuery/.test(queryClient),
  "lib/query/query-client.ts should use the shared retry policy",
);
assert(
  /retryDelay:/.test(queryClient) && /getQueryRetryDelayMs/.test(queryClient),
  "lib/query/query-client.ts should use the shared retry delay",
);
assert(
  /rateLimitCoordinator\.noteRecovered\(\)/.test(queryClient),
  "lib/query/query-client.ts should close the shared window once a request succeeds",
);
assert(
  /getRateLimitInfo\(error\) !== null\) return;/.test(queryClient),
  "a 429 must not count towards the consecutive-401 forced logout",
);

// 4. The stampede guard exists and is coordinated, not per-query.

const coordinator = read("lib/api/rate-limit-coordinator.ts");
assert(
  /RATE_LIMIT_STAGGER_MS/.test(coordinator) &&
    /RATE_LIMIT_JITTER_MS/.test(coordinator),
  "lib/api/rate-limit-coordinator.ts should stagger and jitter resumes so a fan-out does not re-trip the limiter",
);
assert(
  /Math\.max\(snapshot\.resumeAt as number, nowMs \+ info\.retryAfterMs\)/.test(
    coordinator,
  ),
  "the shared window should take the longest Retry-After anyone was given",
);

// 5. The calm state is calm, and its countdown is not read out every second.

const calmState = read("components/ui/RateLimitedState.tsx");
const calmStateCode = stripComments(calmState);

assert(
  !/role="alert"/.test(calmStateCode),
  'RateLimitedState should not use role="alert" — being throttled is informational, not an error',
);
assert(
  /role="status"/.test(calmStateCode) && /className="sr-only"/.test(calmStateCode),
  "RateLimitedState should announce once through a polite, visually hidden status region",
);
assert(
  /\{countdown\}/.test(calmStateCode) &&
    /aria-hidden="true"\s*\n\s*>\s*\n?\s*\{countdown\}/.test(calmStateCode),
  "the ticking countdown should be aria-hidden so it does not spam a screen reader",
);
assert(
  /contact-support|support-email/.test(calmStateCode) === false,
  "RateLimitedState should not offer support — there is nothing to report",
);
assert(
  /text-muted-foreground/.test(calmStateCode) &&
    !/text-destructive|bg-destructive|text-red-|bg-red-/.test(calmStateCode),
  "RateLimitedState should stay in the neutral register, not the destructive one",
);
assert(
  /<Clock\b/.test(calmStateCode),
  "RateLimitedState should carry a non-colour cue alongside its text",
);

// 6. Every surface that could show an error screen degrades to it instead.

const appErrorState = stripComments(read("components/error/AppErrorState.tsx"));
assert(
  /category === "rate-limit"/.test(appErrorState) &&
    /<RateLimitedState/.test(appErrorState),
  "AppErrorState should render the calm state for a rate-limit, not the error screen",
);

const dataLoadError = stripComments(read("components/ui/DataLoadError.tsx"));
assert(
  /isRateLimitError\(error\)/.test(dataLoadError) &&
    /<RateLimitedState/.test(dataLoadError),
  "DataLoadError should degrade a 429 to the calm state",
);

const reportErrorState = stripComments(
  read("components/reports/primitives/ReportErrorState.tsx"),
);
assert(
  /isRateLimitError\(error\)/.test(reportErrorState) &&
    /variant="inline"/.test(reportErrorState),
  "ReportErrorState should degrade a 429 to the inline calm state",
);

// 7. The fan-out pages actually pass their error down, or the branch is dead.

const reportComponents = [
  "BudgetVsActualReport",
  "CashflowReport",
  "NetWorthHistoryReport",
  "PortfolioPerformanceReport",
  "SankeyReport",
  "SpendingByCategoryReport",
];

for (const component of reportComponents) {
  const source = read(`components/reports/reports/${component}.tsx`);
  assert(
    /<ReportErrorState[\s\S]{0,240}?error=\{error\}/.test(source),
    `${component} should pass its query error to ReportErrorState, or a shared 429 renders as a fault`,
  );
}

for (const [file, needle] of [
  ["app/[locale]/(full-layout)/home-client.tsx", "error={budgetsError}"],
  ["app/[locale]/(full-layout)/home-client.tsx", "error={netWorthError}"],
  ["app/[locale]/(full-layout)/dashboard-client.tsx", "error={transactionsError}"],
] as const) {
  assert(
    read(file).includes(needle),
    `${file} should pass \`${needle}\` so the panel can tell a wait from a fault`,
  );
}

// 8. Copy is translated, in all three locales, and not copied from English.

const locales = ["en", "pt", "es"] as const;
const requiredKeys = [
  "rate-limited-title",
  "rate-limited-description",
  "rate-limited-retrying-in",
  "rate-limited-retrying-now",
  "rate-limited-available-in",
  "rate-limited-available-now",
  "rate-limited-announcement",
  "rate-limited-announcement-wait",
];

const english = JSON.parse(read("messages/en/common.json")) as Record<
  string,
  unknown
>;

for (const locale of locales) {
  const messages = JSON.parse(read(`messages/${locale}/common.json`)) as Record<
    string,
    unknown
  >;

  for (const key of requiredKeys) {
    const value = messages[key];
    assert(
      typeof value === "string" && value.trim().length > 0,
      `messages/${locale}/common.json should define a non-empty "${key}"`,
    );

    if (locale !== "en") {
      assert(
        value !== english[key],
        `messages/${locale}/common.json should translate "${key}", not copy the English string`,
      );
    }
  }

  for (const key of ["rate-limited-retrying-in", "rate-limited-available-in"]) {
    assert(
      String(messages[key]).includes("{seconds}"),
      `messages/${locale}/common.json "${key}" should interpolate {seconds}`,
    );
  }

  // The announced line carries the window, so a screen-reader user learns the
  // duration from the single announcement rather than from the silent ticker.
  for (const key of [
    "rate-limited-announcement",
    "rate-limited-announcement-wait",
  ]) {
    const value = String(messages[key]);

    assert(
      /\{seconds,\s*plural,/.test(value),
      `messages/${locale}/common.json "${key}" should carry the window as an ICU plural`,
    );
    assert(
      /\bone\s*\{/.test(value) && /\bother\s*\{/.test(value),
      `messages/${locale}/common.json "${key}" should declare both plural forms`,
    );

    let depth = 0;
    for (const character of value) {
      if (character === "{") depth += 1;
      if (character === "}") depth -= 1;
      assert(depth >= 0, `messages/${locale}/common.json "${key}" has unbalanced braces`);
    }
    assert(depth === 0, `messages/${locale}/common.json "${key}" has unbalanced braces`);
  }
}

console.log("rate limit UI regression checks passed");
