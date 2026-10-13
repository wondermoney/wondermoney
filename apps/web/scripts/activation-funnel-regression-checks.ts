import { readFileSync } from "node:fs";
import { join } from "node:path";

// `lib/analytics/attribution.test.ts` and `lib/analytics/signup.test.ts` used
// to be side-imported here, because `test:activation-funnel` was the only
// script that ran them. `pnpm test` collects every `*.test.ts` in the repo, so
// they run on their own now; re-importing them would register suites inside a
// running test.

const root = process.cwd();

function read(path: string) {
  return readFileSync(join(root, path), "utf8");
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const analytics = [
  read("lib/analytics/events.ts"),
  read("lib/analytics/activation.ts"),
  read("lib/analytics/first-value.ts"),
  read("lib/analytics/signup.ts"),
].join("\n");
const signupForm = [
  read("components/auth/SignupForm.tsx"),
  read("components/auth/SignupFormView.tsx"),
  read("components/auth/signup-form-contract.ts"),
].join("\n");
const recaptchaRoute = read("app/api/recaptcha/route.ts");
const recaptchaBypass = read("lib/utils/recaptcha-e2e-bypass.ts");
const routeShell = read(
  "components/onboarding/first-run/FirstRunOnboardingRouteShell.tsx",
);
const goalsStep = read("components/onboarding/first-run/FirstRunGoalsStep.tsx");
const accountStep = read("components/onboarding/first-run/FirstRunAccountStep.tsx");
const completeStep = read(
  "components/onboarding/first-run/FirstRunCompleteStep.tsx",
);
const homeClient = read("app/[locale]/(full-layout)/home-client.tsx");
const accountsClient = read("app/[locale]/(full-layout)/accounts/accounts-client.tsx");
const netWorthViewedEvent = read("components/dashboard/NetWorthViewedEvent.tsx");
const signupCompletionTracker = read("components/analytics/SignupCompletionTracker.tsx");
const providers = read("app/providers.tsx");
const authCompleteRoute = read("app/[locale]/(no-layout)/auth/complete/route.ts");
const authCallbackRoute = read("app/[locale]/(no-layout)/auth/callback/route.ts");
const analyticsPageView = read("app/AnalyticsPageView.tsx");
const feedbackRoutePrivacy = read("lib/analytics/feedback-route-privacy.ts");

function getFunctionBody(source: string, functionName: string) {
  const match = source.match(
    new RegExp(`export function ${functionName}\\([\\s\\S]*?\\) \\{([\\s\\S]*?)\\n\\}`),
  );

  const body = match?.[1];
  assert(body, `${functionName} body must be present`);
  return body;
}

const activationEvents = [
  "signup_submit_clicked",
  "signup_submit_succeeded",
  "signup_submit_failed",
  "onboarding_started",
  "onboarding_step_viewed",
  "onboarding_step_completed",
  "onboarding_completed",
  "first_account_added",
  "dashboard_first_viewed",
  "first_net_worth_rendered",
] as const;

const signupFunnelEvents = ["signup_started", "signup_completed"] as const;

assert(
  /export const ACTIVATION_EVENTS\s*=\s*\{/.test(analytics),
  "analytics helper must export ACTIVATION_EVENTS",
);

assert(
  /export const SIGNUP_FUNNEL_EVENTS\s*=\s*\{/.test(analytics),
  "analytics helper must export SIGNUP_FUNNEL_EVENTS",
);

for (const eventName of activationEvents) {
  assert(
    analytics.includes(`"${eventName}"`),
    `ACTIVATION_EVENTS must expose ${eventName}`,
  );
}

for (const eventName of signupFunnelEvents) {
  assert(
    analytics.includes(`"${eventName}"`),
    `SIGNUP_FUNNEL_EVENTS must expose ${eventName}`,
  );
}

assert(
  /export type ActivationEventName\s*=/.test(analytics),
  "analytics helper must export an ActivationEventName type",
);

assert(
  /export type SignupFunnelEventName\s*=/.test(analytics),
  "analytics helper must export a SignupFunnelEventName type",
);

assert(
  /export const ACTIVATION_EVENT_DEDUPE_POLICIES\s*=\s*\{/.test(analytics),
  "analytics helper must document activation event dedupe policies",
);

for (const [eventKey, policy] of [
  ["dashboardFirstViewed", "session"],
  ["firstNetWorthRendered", "user"],
  ["onboardingStepViewed", "step_view"],
  ["onboardingStepCompleted", "action"],
] as const) {
  assert(
    new RegExp(
      `\\[ACTIVATION_EVENTS\\.${eventKey}\\]:\\s*"${policy}"`,
    ).test(analytics),
    `ACTIVATION_EVENTS.${eventKey} must use ${policy} dedupe policy`,
  );
}

for (const helperName of [
  "getActivationDedupeKey",
  "hasTrackedActivationEvent",
  "markActivationEventTracked",
  "isValidFirstNetWorthState",
] as const) {
  assert(
    analytics.includes(`export function ${helperName}`),
    `analytics helper must export ${helperName}`,
  );
}

assert(
  /export function captureSignupFunnelEvent/.test(analytics),
  "analytics helper must export captureSignupFunnelEvent",
);

// The consent ledger feature (per-user analytics consent gate) was
// deliberately removed in full (commit 105756b6, "Remove the consent
// ledger feature"): analytics now enable purely from env config, with no
// consent snapshot to read. The remaining invariant is that signup funnel
// capture still no-ops before touching PostHog/dataLayer when analytics is
// disabled by env.
assert(
  analytics.includes("function isSignupFunnelAnalyticsEnabled") &&
    analytics.includes("NEXT_PUBLIC_ENABLE_ANALYTICS") &&
    /if \(!isSignupFunnelAnalyticsEnabled\(\)\) return;[\s\S]*const safeProperties = sanitizeActivationProperties\(properties\)/.test(
      analytics,
    ),
  "signup funnel helper must no-op before capture/dataLayer when analytics is disabled",
);

assert(
  /if \(!analyticsEnabled\) \{[\s\S]*removePendingSignupCompletion\(\);[\s\S]*return;[\s\S]*\}/.test(
    signupCompletionTracker,
  ) && signupCompletionTracker.includes("if (!user?.id) return;"),
  "signup completion tracker must clear legacy pending events whenever analytics is denied or undecided",
);

// The pageview URL sanitization params/function were extracted out of
// AnalyticsPageView.tsx into the shared lib/analytics/feedback-route-privacy.ts
// helper (also reused for trial-expiry feedback route filtering). The
// invariant -- sensitive query params are always stripped before capture --
// now lives in that helper; AnalyticsPageView.tsx just has to call it instead
// of reimplementing URL sanitization inline.
assert(
  feedbackRoutePrivacy.includes("PAGEVIEW_QUERY_PARAMS_TO_DROP") &&
    feedbackRoutePrivacy.includes('"access_token"') &&
    feedbackRoutePrivacy.includes('"code"') &&
    feedbackRoutePrivacy.includes('"error_description"') &&
    feedbackRoutePrivacy.includes('"promoCodeOrReferralCode"') &&
    feedbackRoutePrivacy.includes('"promoCodeOrReferralOrigin"') &&
    feedbackRoutePrivacy.includes('"refresh_token"') &&
    feedbackRoutePrivacy.includes('"signup_completed"') &&
    feedbackRoutePrivacy.includes('"signup_method"') &&
    feedbackRoutePrivacy.includes('"signup_source"') &&
    feedbackRoutePrivacy.includes('"token"') &&
    feedbackRoutePrivacy.includes("export function getSanitizedPageviewUrl"),
  "feedback-route-privacy helper must sanitize pageview URLs before capture",
);

assert(
  analyticsPageView.includes("getSanitizedPageviewUrl") &&
    analyticsPageView.includes(
      "const url = getSanitizedPageviewUrl(window.origin, pathname, searchParams);",
    ) &&
    !analyticsPageView.includes("let url = window.origin + pathname;") &&
    !analyticsPageView.includes("url = url + `?${searchParams.toString()}`;"),
  "AnalyticsPageView must delegate pageview URL sanitization to the shared helper instead of reimplementing it inline",
);

const captureSignupFunnelEventBody = getFunctionBody(
  analytics,
  "captureSignupFunnelEvent",
);

assert(
  /const safeProperties = sanitizeActivationProperties\(properties\)/.test(
    captureSignupFunnelEventBody,
  ),
  "signup funnel helper must sanitize properties",
);

assert(
  /client\?\.capture\(eventName, safeProperties\)/.test(
    captureSignupFunnelEventBody,
  ),
  "signup funnel helper must capture to PostHog with sanitized properties",
);

assert(
  /if \(typeof window === "undefined"\) return;/.test(
    captureSignupFunnelEventBody,
  ),
  "signup funnel helper must return early on the server",
);

assert(
  /window\.dataLayer\s*=\s*window\.dataLayer\s*\?\?\s*\[\]/.test(
    captureSignupFunnelEventBody,
  ),
  "signup funnel helper must initialize or reuse window.dataLayer",
);

assert(
  /window\.dataLayer\.push\(\{ \.\.\.safeProperties, event: eventName \}\)/.test(
    captureSignupFunnelEventBody,
  ),
  "signup funnel helper must push event payloads to dataLayer",
);

assert(
  signupForm.includes("SIGNUP_FUNNEL_EVENTS") &&
    signupForm.includes("captureSignupFunnelEvent") &&
    signupForm.includes("getSignupFailureCategory") &&
    signupForm.includes("const [hydrated, setHydrated] = useState(false);") &&
    signupForm.includes('method="post"') &&
    signupForm.includes("disabled={!hydrated || form.formState.isSubmitting}") &&
    signupForm.includes("setHydrated(true);"),
  "signup form must use the signup funnel analytics helpers",
);

assert(
  signupForm.includes("function canBypassRecaptchaClientFailure") &&
    signupForm.includes("canBypassRecaptchaForE2E") &&
    signupForm.includes("NEXT_PUBLIC_E2E_BYPASS_RECAPTCHA") &&
    signupForm.includes("NEXT_PUBLIC_VERCEL_ENV"),
  "signup form must keep the client reCAPTCHA bypass rule explicit and env-gated",
);

assert(
  recaptchaBypass.includes('"app.wonder.money"') &&
    recaptchaBypass.includes("PRODUCTION_RECAPTCHA_HOSTS") &&
    recaptchaBypass.includes('vercelEnv === "production"'),
  "recaptcha bypass helper must fail closed for the production app origin and production Vercel env",
);

assert(
  signupForm.includes('signup_source", "signup_form"') &&
    signupForm.includes('signup_method", "email"') &&
    signupForm.includes('signup_completed", "1"') &&
    signupForm.includes("shouldTrackSignupCompletion(callbackOutcome)"),
  "signup form must route successful signup completion through marker params",
);

assert(
  signupForm.includes('error: "reCAPTCHA is unavailable"') &&
    signupForm.includes('action: "non_production_bypass"'),
  "signup form must fail closed for unavailable-provider errors while exposing the explicit bypass marker",
);

assert(
  !signupForm.includes("reCAPTCHA not available, skip verification") &&
    !signupForm.includes("If verification fails, allow signup to proceed"),
  "signup form must not retain old fail-open comments",
);

assert(
  /if \(!executeRecaptcha\)\s*{[\s\S]*return \{ success: false/.test(
    signupForm,
  ),
  "signup form must fail closed when reCAPTCHA provider is unavailable",
);

assert(
  /catch \{[\s\S]*return \{ success: false/.test(signupForm),
  "signup form must fail closed when reCAPTCHA verification throws",
);

assert(
  recaptchaRoute.includes("function canBypassRecaptchaConfiguration") &&
    recaptchaRoute.includes("canBypassRecaptchaForE2E") &&
    recaptchaRoute.includes("E2E_BYPASS_RECAPTCHA") &&
    recaptchaRoute.includes("process.env.VERCEL_ENV"),
  "recaptcha route must keep the non-production bypass rule explicit and env-gated",
);

assert(
  /if \(canBypassRecaptchaConfiguration\(\)\) \{[\s\S]*return NextResponse\.json<RecaptchaVerifyResponse>\({[\s\S]*action: "non_production_bypass"/.test(
    recaptchaRoute,
  ),
  "recaptcha route must bypass before token validation when the explicit E2E flag is enabled",
);

assert(
  recaptchaRoute.includes("reCAPTCHA is not configured"),
  "recaptcha route must return a clear missing-secret error",
);

assert(
  recaptchaRoute.includes('action: "non_production_bypass"') &&
    recaptchaRoute.includes('success: true'),
  "recaptcha route must mark explicit bypass responses",
);

assert(
  !recaptchaRoute.includes("Skip verification if secret key is not configured"),
  "recaptcha route must not retain the old missing-secret fail-open behavior",
);

assert(
  recaptchaBypass.includes('vercelEnv === "production"') &&
    recaptchaBypass.includes('"app.wonder.money"') &&
    /RECAPTCHA_SECRET_KEY[\s\S]*return NextResponse\.json<RecaptchaVerifyResponse>\([\s\S]*success: false/.test(
      recaptchaRoute,
    ),
  "recaptcha route must fail closed when the secret key is missing in production",
);

assert(
  recaptchaRoute.includes("development_bypass") ||
    recaptchaRoute.includes("non_production_bypass"),
  "recaptcha route must expose an obvious non-production bypass signal",
);

for (const eventKey of ["started", "submitClicked", "submitFailed"] as const) {
  assert(
    signupForm.includes(`SIGNUP_FUNNEL_EVENTS.${eventKey}`),
    `signup form must capture SIGNUP_FUNNEL_EVENTS.${eventKey}`,
  );
}

for (const eventKey of ["submitSucceeded", "completed"] as const) {
  assert(
    !signupForm.includes(`SIGNUP_FUNNEL_EVENTS.${eventKey}`),
    `signup form must not directly capture SIGNUP_FUNNEL_EVENTS.${eventKey}`,
  );
}

assert(
  /failure_category:\s*getSignupFailureCategory\(/.test(signupForm),
  "signup failure analytics must use a safe failure_category",
);

const signupFailureCaptures =
  signupForm.match(
    /captureSignupFunnelEvent\([\s\S]*?SIGNUP_FUNNEL_EVENTS\.submitFailed[\s\S]*?\n\s*\}\);/g,
  ) ?? [];

assert(
  signupFailureCaptures.length >= 3,
  "signup form must capture recaptcha, provider, and callback failure states",
);

for (const captureCall of signupFailureCaptures) {
  assert(
    !/(raw_error|error_message|error_detail|rawError|errorMessage|errorDetail)/.test(
      captureCall,
    ),
    "signup failure analytics must not capture raw error details",
  );
}

assert(
  !/posthog\?\.capture\("signup_started"/.test(signupForm) &&
    !/posthog\?\.capture\("signup_completed"/.test(signupForm) &&
    !/captureSignupFunnelEvent\([\s\S]*?SIGNUP_FUNNEL_EVENTS\.submitSucceeded/.test(
      signupForm,
    ) &&
    !/captureSignupFunnelEvent\([\s\S]*?SIGNUP_FUNNEL_EVENTS\.completed/.test(
      signupForm,
    ),
  "signup form must not call signup funnel events directly via posthog capture",
);

assert(
  !/window\.dataLayer\?\.push\(/.test(signupForm),
  "signup form must not push signup funnel events directly to dataLayer",
);

assert(
  signupCompletionTracker.includes("captureSignupFunnelEvent") &&
    signupCompletionTracker.includes("SIGNUP_FUNNEL_EVENTS.submitSucceeded") &&
    signupCompletionTracker.includes("SIGNUP_FUNNEL_EVENTS.completed") &&
    signupCompletionTracker.includes("analyticsEnabled: boolean"),
  "signup completion tracker must emit submitSucceeded and completed",
);

assert(
  signupCompletionTracker.includes("SIGNUP_COMPLETION_PENDING_KEY") &&
    signupCompletionTracker.includes("writePendingSignupCompletion({ method, locale, source });") &&
    signupCompletionTracker.includes("readPendingSignupCompletion()") &&
    signupCompletionTracker.includes("removePendingSignupCompletion();") &&
    signupCompletionTracker.includes("if (signupCompleted === \"1\") {") &&
    /if \(!analyticsEnabled\) \{[\s\S]*cleanup\(\);[\s\S]*removePendingSignupCompletion\(\);[\s\S]*return;[\s\S]*\}/.test(
      signupCompletionTracker,
    ) &&
    signupCompletionTracker.includes("if (!user?.id) return;") &&
    !signupCompletionTracker.includes('if (signupCompleted !== "1") return;'),
  "signup completion tracker must create pending payloads only for events observed with analytics consent",
);

assert(
  signupCompletionTracker.includes("normalizeSignupSource") &&
    signupCompletionTracker.includes("normalizeSignupMethod") &&
    signupCompletionTracker.includes("ALLOWED_SOURCES") &&
    signupCompletionTracker.includes("ALLOWED_METHODS") &&
    !signupCompletionTracker.includes('url.searchParams.get("signup_source") ?? "auth_callback"') &&
    !signupCompletionTracker.includes('url.searchParams.get("signup_method") ?? "email"'),
  "signup completion tracker must whitelist and normalize marker params",
);

assert(
  signupCompletionTracker.includes("sessionStorage.getItem(dedupeKey)") &&
    signupCompletionTracker.includes("sessionStorage.setItem(dedupeKey") &&
    signupCompletionTracker.includes("signup_completed") &&
    signupCompletionTracker.includes("signup_method") &&
    signupCompletionTracker.includes("signup_source") &&
    signupCompletionTracker.includes("auth_callback") &&
    signupCompletionTracker.includes("auth_complete") &&
    signupCompletionTracker.includes("signup_form") &&
    signupCompletionTracker.includes("unknown") &&
    signupCompletionTracker.includes("cleanup()") &&
    signupCompletionTracker.includes("window.location.href") &&
    signupCompletionTracker.includes("window.history.replaceState"),
  "signup completion tracker must normalize, dedupe, and cleanup completion params",
);

assert(
  /if \(!analyticsEnabled\) \{[\s\S]*removePendingSignupCompletion\(\);[\s\S]*return;[\s\S]*\}/.test(
    signupCompletionTracker,
  ) &&
    signupCompletionTracker.includes("if (!source) {") &&
    signupCompletionTracker.includes("if (window.sessionStorage.getItem(dedupeKey) === \"true\")") &&
    signupCompletionTracker.includes("cleanup();") &&
    signupCompletionTracker.includes("if (!user?.id) return;") &&
    signupCompletionTracker.indexOf("if (!user?.id) return;") >
      signupCompletionTracker.indexOf("if (signupCompleted === \"1\") {"),
  "signup completion tracker must discard pending events on denial and cleanup invalid, deduped, and captured paths",
);

assert(
  signupCompletionTracker.includes("window.location.href") &&
    signupCompletionTracker.includes("window.history.replaceState") &&
    signupCompletionTracker.includes("signup_completed") &&
    signupCompletionTracker.includes("signup_method") &&
    signupCompletionTracker.includes("signup_source"),
  "signup completion tracker must read and clear completion query params",
);

assert(
  providers.includes("SignupCompletionTracker") &&
    providers.includes(
      "<SignupCompletionTracker analyticsEnabled={isAnalyticsEnabled()} />",
    ) &&
    !providers.includes("<UserIdentification />"),
  "providers must render SignupCompletionTracker unconditionally with analyticsEnabled",
);

assert(
  authCompleteRoute.includes("type AuthCallbackResponse") &&
    authCompleteRoute.includes("api.post<AuthCallbackResponse>") &&
    authCompleteRoute.includes("function shouldMarkAuthCompleteSignup") &&
    authCompleteRoute.includes("callbackResult?.outcome === undefined") &&
    authCompleteRoute.includes('callbackResult.outcome === "signup"') &&
    authCompleteRoute.includes("shouldMarkAuthCompleteSignup(callbackResult)") &&
    authCompleteRoute.includes('successUrl.searchParams.set("signup_completed", "1")') &&
    authCompleteRoute.includes("signup_method") &&
    authCompleteRoute.includes('successUrl.searchParams.set("signup_source", "auth_complete")'),
  "auth complete route must add signup completion markers on signup or legacy missing outcomes",
);

assert(
  authCompleteRoute.includes("buildSafeAuthOrigin") &&
    authCompleteRoute.includes("const safeOrigin = buildSafeAuthOrigin") &&
    authCompleteRoute.includes("Missing NEXT_PUBLIC_APP_URL for auth complete redirects") &&
    authCompleteRoute.includes("new URL(buildLocalizedAuthErrorPath(locale), safeOrigin)") &&
    authCompleteRoute.includes("new URL(`/${locale}/auth/mfa`, safeOrigin)"),
  "auth complete route must use the configured safe auth origin for redirects",
);

assert(
  authCallbackRoute.includes("type AuthCallbackResponse") &&
    authCallbackRoute.includes("stripSignupCompletionParamsFromPath") &&
    authCallbackRoute.includes("SIGNUP_COMPLETION_QUERY_PARAMS") &&
    authCallbackRoute.includes('"signup_completed"') &&
    authCallbackRoute.includes('"signup_method"') &&
    authCallbackRoute.includes('"signup_source"') &&
    authCallbackRoute.includes("sanitizeNextPath(searchParams.get(\"next\"))") &&
    authCallbackRoute.includes("appendSignupCompletionParams") &&
    authCallbackRoute.includes('callbackResult?.outcome !== "signup"') &&
    authCallbackRoute.includes('redirectUrl.searchParams.set("signup_source", "auth_callback")') &&
    authCallbackRoute.includes("signup_method"),
  "auth callback route must strip incoming markers and add new markers only on explicit signup outcomes",
);

assert(
  authCompleteRoute.includes("redirectTo: `${result.successUrl.pathname}${result.successUrl.search}`"),
  "auth complete POST redirect must preserve search params",
);

assert(
  routeShell.includes("captureActivationEvent") &&
    routeShell.includes("ACTIVATION_EVENTS.onboardingStarted") &&
    routeShell.includes("ACTIVATION_EVENTS.onboardingStepViewed"),
  "route shell must capture generic activation onboarding start and step view events",
);

assert(
  /ACTIVATION_EVENTS\.onboardingStepViewed[\s\S]*step:\s*currentStep/.test(
    routeShell,
  ),
  "onboarding step viewed analytics must include the current step",
);

for (const [label, content, step] of [
  ["goals step", goalsStep, "goals"],
  ["account step", accountStep, "account"],
  ["complete step", completeStep, "completion"],
] as const) {
  assert(
    content.includes("captureActivationEvent") &&
      content.includes("ACTIVATION_EVENTS.onboardingStepCompleted"),
    `${label} must capture generic activation step completion events`,
  );
  assert(
    new RegExp(`ACTIVATION_EVENTS\\.onboardingStepCompleted[\\s\\S]*step:\\s*"${step}"`).test(
      content,
    ),
    `${label} completion analytics must include step: "${step}"`,
  );
}

// The "Your first net worth is ready" card -- and the whole first-value
// dashboard mode it anchored -- was removed on purpose in commit bd69abc7
// ("feat(dashboard): remove first-value card + trial nudge; move trial to
// sidebar", #143). `isFirstValueDashboard(Context)` no longer exists and the
// `dashboard-first-value-*` copy was deleted from en/pt/es in the same commit;
// a brand-new user now gets the ordinary dashboard. The checks below therefore
// stopped asserting that card and instead pin what the removal did NOT touch:
// the activation signal itself. `first_net_worth_rendered` still must not fire
// off a spinner, an error, or a missing figure.
assert(
  homeClient.includes("isValidFirstNetWorthState") &&
    homeClient.includes("firstNetWorthVisible") &&
    homeClient.includes("getFirstRunState"),
  "home client must derive first-net-worth visibility from loaded net worth data",
);

assert(
  /hasValidNetWorthPayload\s*=[\s\S]{0,160}?typeof totalNetWorth === "number"[\s\S]{0,80}?Number\.isFinite\(totalNetWorth\)/.test(
    homeClient,
  ),
  "a net worth payload only counts as valid when it carries a finite number",
);

assert(
  /firstNetWorthVisible\s*=\s*isValidFirstNetWorthState\(\{[\s\S]{0,400}?isLoaded:\s*hasValidNetWorthPayload && !isNetWorthLoading && !isNetWorthError/.test(
    homeClient,
  ),
  "first net worth readiness must require a valid payload that has finished loading without error",
);

assert(
  /<NetWorthViewedEvent[\s\S]*accountCount=\{accountCount\}[\s\S]*portfolioCount=\{portfolioCount\}[\s\S]*isLoaded=\{firstNetWorthVisible\}/.test(
    homeClient,
  ),
  "home client must pass loaded account and portfolio state into NetWorthViewedEvent",
);

assert(
  !homeClient.includes("isFirstValueDashboard") &&
    !homeClient.includes("dashboard-first-value"),
  "the first-value dashboard mode stays removed (bd69abc7); bringing it back needs new en/pt/es copy and a deliberate guard update, not a silent revert",
);

assert(
  /<SetupChecklistCard[\s\S]{0,400}?hasAccount=\{[\s\S]{0,400}?hasReviewedTransactions=\{[\s\S]{0,400}?hasBudget=\{[\s\S]{0,400}?hasPortfolio=\{/.test(
    homeClient,
  ),
  "the setup checklist is the dashboard's activation guidance now that the first-value card is gone, and it must keep receiving every completion signal",
);

assert(
  netWorthViewedEvent.includes("ACTIVATION_EVENTS.dashboardFirstViewed") &&
    netWorthViewedEvent.includes("ACTIVATION_EVENTS.firstNetWorthRendered") &&
    netWorthViewedEvent.includes("hasTrackedActivationEvent") &&
    netWorthViewedEvent.includes("markActivationEventTracked"),
  "NetWorthViewedEvent must capture deduped dashboard and first net worth activation events",
);

assert(
  /posthog\?\.capture\("net_worth_viewed"/.test(netWorthViewedEvent) &&
    /didCaptureLegacyNetWorthViewedRef/.test(netWorthViewedEvent),
  "NetWorthViewedEvent must preserve legacy per-mount net_worth_viewed semantics separately from activation dedupe",
);

assert(
  homeClient.includes("captureLegacyNetWorthViewed={false}"),
  "no-account dashboard_first_viewed tracking must not emit legacy net_worth_viewed",
);

assert(
  /account_count:\s*accountCount/.test(netWorthViewedEvent) &&
    /portfolio_count:\s*portfolioCount/.test(netWorthViewedEvent) &&
    /locale/.test(netWorthViewedEvent),
  "NetWorthViewedEvent must include safe count/source/locale properties",
);

assert(
  accountsClient.includes("ACTIVATION_EVENTS.firstAccountAdded") &&
    accountsClient.includes("captureActivationEvent"),
  "accounts client must capture first_account_added after first account creation succeeds",
);
