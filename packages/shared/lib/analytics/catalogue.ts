import { featureScreens } from './feature-screens';
import type {
  AnalyticsCatalogue,
  AnalyticsSurface,
  CatalogueCaptureArgs,
  CatalogueEventName,
  CatalogueEventProperties,
} from './types';

/** The sign-in methods the API knows; `other` covers any provider added later. */
const SIGN_IN_METHODS = ['email', 'google', 'apple', 'oidc', 'other'] as const;

/** `Appuser.language`, as the API stores it. */
const LOCALES = ['EN', 'PT', 'ES', 'IT'] as const;

/**
 * The transaction import formats (`IMPORT_FORMATS` in `lib/import/types.ts`; this entry is
 * dependency-free, so `catalogue.test.ts` keeps the two equal), and `broker_csv` for a portfolio
 * import.
 */
export const ANALYTICS_IMPORT_FORMATS = [
  'statement',
  'ofx',
  'qif',
  'generic-csv',
  'camt053',
  'ynab',
  'actual',
  'pdf',
  'broker_csv',
] as const;

export type AnalyticsImportFormat = (typeof ANALYTICS_IMPORT_FORMATS)[number];

/** A format a client read from the API, as the catalogue's `format`, or `undefined` for one it does not list. */
export function analyticsImportFormat(value: unknown): AnalyticsImportFormat | undefined {
  return (ANALYTICS_IMPORT_FORMATS as readonly unknown[]).includes(value)
    ? (value as AnalyticsImportFormat)
    : undefined;
}

const BANK_PROVIDERS = ['enable_banking', 'simplefin'] as const;

/**
 * Where a visitor to the wonder.money website came from, in five coarse classes: an AI assistant
 * (ChatGPT, Perplexity, Gemini, Copilot, Claude), a search engine, a social network, no referrer
 * at all, or anything else. The website classifies the referrer and `utm_source` itself
 * (`apps/landing/src/lib/referrerClass.ts`); neither the referrer nor the campaign values travel
 * further (`docs/landing-attribution.md`).
 */
export const ANALYTICS_REFERRER_CLASSES = ['ai_assistant', 'search', 'social', 'direct', 'other'] as const;

export type AnalyticsReferrerClass = (typeof ANALYTICS_REFERRER_CLASSES)[number];

const PLATFORMS = ['web', 'mobile', 'api'] as const;

/**
 * The steps of the Enable Banking key setup wizard, in order, by their stable ids
 * (`ENABLE_BANKING_SETUP_STEP` in web's `components/settings/BankProvider/enable-banking-setup-steps.ts`;
 * web's tests keep the two equal).
 */
export const ANALYTICS_BANK_KEY_SETUP_STEPS = [
  'sign_in',
  'create_application',
  'activate',
  'application_id',
  'done',
] as const;

export type AnalyticsBankKeySetupStep = (typeof ANALYTICS_BANK_KEY_SETUP_STEPS)[number];

/** Where the person opened the Enable Banking key setup from. */
export const ANALYTICS_BANK_KEY_SETUP_ENTRIES = [
  'first_run',
  'add_account',
  'home_card',
  'bank_picker',
  'settings',
] as const;

export type AnalyticsBankKeySetupEntry = (typeof ANALYTICS_BANK_KEY_SETUP_ENTRIES)[number];

/** The steps of web's first-run onboarding (`lib/onboarding/first-run/types.ts` in the web app). */
const onboardingStep = {
  type: 'enum',
  values: ['welcome', 'goals', 'privacy', 'account', 'sync_value', 'completion'],
  description: 'The onboarding step.',
} as const;

const importProperties = {
  kind: {
    type: 'enum',
    values: ['transactions', 'portfolio'],
    description:
      'Transactions into accounts, or a portfolio from a broker export.',
  },
  format: {
    type: 'enum',
    values: ANALYTICS_IMPORT_FORMATS,
    description:
      'The file format, once known (`statement` is a bank CSV, `pdf` the AI statement import).',
    optional: true,
  },
} as const;

const requiredPlatform = {
  type: 'enum',
  values: PLATFORMS,
  description:
    'Which client sent the request: the web app, the mobile app, or a personal API token or MCP client.',
} as const;

/** Absent when the change was made by the server itself (a sync, a scheduled job). */
const platform = { ...requiredPlatform, optional: true } as const;

const BANK_SYNC_PROPERTIES = {
  account_count: {
    type: 'count',
    description: 'Accounts the sync covered.',
    optional: true,
  },
  attempt: { type: 'count', description: 'Which attempt this was, from 1.' },
  contract_version: {
    type: 'enum',
    values: ['bank-sync.v1'],
    description: 'The version of these properties.',
  },
  environment: {
    type: 'enum',
    values: ['production', 'staging', 'development'],
    description: 'The server that ran the sync.',
  },
  error_category: {
    type: 'enum',
    values: [
      'authentication',
      'cancelled',
      'consent',
      'data_validation',
      'internal',
      'provider',
      'queue',
      'timeout',
      'unknown',
    ],
    description: 'The kind of failure.',
    optional: true,
  },
  error_code: {
    type: 'enum',
    values: [
      'account_phase_failed',
      'authentication',
      'balance_unavailable',
      'cancelled',
      'consent_expired',
      'data_validation',
      'institution_action_required',
      'institution_unavailable',
      'internal',
      'invalid_requisition',
      'provider_unavailable',
      'queue_unavailable',
      'rate_limited',
      'timeout',
      'transaction_phase_failed',
      'unknown',
      'unsupported_currency',
    ],
    description: 'The failure, as a fixed code.',
    optional: true,
  },
  final: {
    type: 'boolean',
    description: 'Whether no further attempt will follow.',
  },
  flow: {
    type: 'enum',
    values: ['initial-add', 'scheduled-refresh'],
    description: 'The first sync of a new connection, or a scheduled refresh.',
  },
  producer: {
    type: 'enum',
    values: ['pgboss-initial', 'pgboss-scheduled'],
    description: 'The job that ran it.',
  },
  result: {
    type: 'enum',
    values: ['full_success', 'partial', 'failed'],
    description: 'How it ended.',
  },
} as const;

/**
 * Every product analytics event WonderMoney sends, on every surface. An event that is not here
 * cannot be sent: web's `track`, mobile's `captureAnalyticsEvent` and the API's analytics outbox
 * are typed by this object and check it again at runtime. Adding or changing an event is a pull
 * request that edits it; `README.md` next to this file has the rules, and
 * `docs/analytics-events.md` is generated from it
 * (`pnpm --filter @wondermoney/shared analytics-events`).
 */
export const ANALYTICS_EVENTS = {
  // Service events: sent by the API for every user of the hosted instance (`README.md`).
  signup: {
    description: 'A new account was created.',
    surfaces: ['server'],
    tier: 'service',
    question: 'activation',
    properties: {
      method: {
        type: 'enum',
        values: SIGN_IN_METHODS,
        description: 'How the person signed up.',
      },
      locale: {
        type: 'enum',
        values: LOCALES,
        description: 'The language of the account.',
      },
      landing_source: {
        type: 'code',
        pattern: /^[a-z][A-Za-z0-9]{1,63}$/u,
        description:
          "The route id of the website's free tool or resource list the signup came from, sent only with analytics consent on both the website and the app (`docs/landing-attribution.md`).",
        optional: true,
      },
      referrer_class: {
        type: 'enum',
        values: ANALYTICS_REFERRER_CLASSES,
        description:
          'Where the visitor came to the website from before signing up (an AI assistant, search, social, direct or other), sent only with analytics consent on both the website and the app (`docs/landing-attribution.md`).',
        optional: true,
      },
    },
  },
  login: {
    description: 'An existing account signed in, once per session.',
    surfaces: ['server'],
    tier: 'service',
    question: 'retention',
    properties: {
      method: {
        type: 'enum',
        values: SIGN_IN_METHODS,
        description: 'How the person signed in.',
      },
      locale: {
        type: 'enum',
        values: LOCALES,
        description: 'The language of the account.',
      },
    },
  },
  user_active: {
    description:
      'The person used WonderMoney today: their first authenticated request of the UTC day, from any client.',
    surfaces: ['server'],
    tier: 'service',
    question: 'retention',
    properties: { platform: requiredPlatform },
  },
  account_created: {
    description: 'A financial account was added to the household.',
    surfaces: ['server'],
    tier: 'service',
    question: 'activation',
    properties: {
      method: {
        type: 'enum',
        values: ['manual', 'bank_connection', 'import'],
        description:
          'Entered by hand, brought in by a bank connection, or created while importing a file.',
      },
      platform,
    },
  },
  first_account_created: {
    description:
      'The first account_created of this person; later ones repeat its event id, so the outbox keeps only the first.',
    surfaces: ['server'],
    tier: 'service',
    question: 'activation',
    properties: {
      method: {
        type: 'enum',
        values: ['manual', 'bank_connection', 'import'],
        description: 'As on account_created.',
      },
      platform,
    },
  },
  budget_created: {
    description: 'A budget was created.',
    surfaces: ['server'],
    tier: 'service',
    question: 'activation',
    properties: { platform },
  },
  first_budget_created: {
    description:
      'The first budget_created of this person; later ones repeat its event id.',
    surfaces: ['server'],
    tier: 'service',
    question: 'activation',
    properties: { platform },
  },
  goal_created: {
    description: 'A goal was created.',
    surfaces: ['server'],
    tier: 'service',
    question: 'activation',
    properties: {
      type: {
        type: 'enum',
        values: ['save_up', 'debt_paydown'],
        description: 'Saving towards an amount, or paying down a debt.',
      },
      platform,
    },
  },
  first_goal_created: {
    description:
      'The first goal_created of this person; later ones repeat its event id.',
    surfaces: ['server'],
    tier: 'service',
    question: 'activation',
    properties: {
      type: {
        type: 'enum',
        values: ['save_up', 'debt_paydown'],
        description: 'As on goal_created.',
      },
      platform,
    },
  },
  import_committed: {
    description:
      'An import finished and wrote at least one row, once per import. One that wrote none (failed, or every row a duplicate) sends nothing.',
    surfaces: ['server'],
    tier: 'service',
    question: 'imports',
    properties: {
      kind: {
        type: 'enum',
        values: ['transactions', 'portfolio'],
        description:
          'Transactions into accounts, or a portfolio from a broker export.',
      },
      format: {
        type: 'enum',
        values: ANALYTICS_IMPORT_FORMATS,
        description:
          'The file format (`statement` is a bank CSV, `pdf` the AI statement import).',
      },
      result: {
        type: 'enum',
        values: ['succeeded', 'partial'],
        description:
          'Every row read was written or skipped as a duplicate, or some rows failed or did not read.',
      },
    },
  },
  bank_connection_completed: {
    description:
      'A bank connection was linked. Its accounts may arrive later, from the first sync.',
    surfaces: ['server'],
    tier: 'service',
    question: 'bank_connections',
    properties: {
      provider: {
        type: 'enum',
        values: BANK_PROVIDERS,
        description: 'The bank data provider.',
      },
      platform,
    },
  },
  bank_connection_failed: {
    description:
      'Connecting a bank failed before any sync ran: the provider refused to start it (before the person reached the bank), or linking it failed afterwards (a refused consent, a bad token, a provider error).',
    surfaces: ['server'],
    tier: 'service',
    question: 'bank_connections',
    properties: {
      provider: {
        type: 'enum',
        values: BANK_PROVIDERS,
        description: 'The bank data provider.',
      },
      reason: {
        type: 'enum',
        values: [
          'authorization_denied',
          'invalid_callback',
          'account_setup_failed',
          'rate_limited',
          'consent_expired',
          'authentication',
          'provider_unavailable',
          'institution_action_required',
          'institution_unavailable',
          'unsupported_currency',
          'token_invalid',
          'token_already_claimed',
          'server_not_allowed',
          'unknown',
        ],
        description: "Why, as a fixed code: never the provider's own message.",
      },
      step: {
        type: 'enum',
        values: ['start', 'link'],
        description:
          "Where it failed: asking the provider to start the connection, so the person never reached the bank (and the app sent no `bank_connection_started`), or linking it after the bank's consent or with SimpleFIN's token. Absent on events recorded before it existed.",
        optional: true,
      },
      platform,
    },
  },
  bank_sync_completed: {
    description:
      'A bank sync attempt ended, other than the two cases below (`analytics/bank-sync-contract.ts` in the API).',
    surfaces: ['server'],
    tier: 'service',
    question: 'bank_connections',
    properties: BANK_SYNC_PROPERTIES,
  },
  account_add_sync_failed: {
    description: "A new connection's first sync did not fully succeed.",
    surfaces: ['server'],
    tier: 'service',
    question: 'bank_connections',
    properties: BANK_SYNC_PROPERTIES,
  },
  account_sync_succeeded: {
    description: 'A scheduled refresh fully succeeded.',
    surfaces: ['server'],
    tier: 'service',
    question: 'bank_connections',
    properties: BANK_SYNC_PROPERTIES,
  },

  bank_key_certificate_created: {
    description:
      'WonderMoney generated an Enable Banking key pair for the person and handed out its certificate to register: their pending key, which lapses after seven days unless activated. Creating another replaces it, and sends this again.',
    surfaces: ['server'],
    tier: 'service',
    question: 'bank_connections',
    properties: {},
  },
  bank_key_activation_failed: {
    description:
      "Activating the person's pending Enable Banking key under the application ID they entered failed, once per attempt. The key stays pending.",
    surfaces: ['server'],
    tier: 'service',
    question: 'bank_connections',
    properties: {
      reason: {
        type: 'enum',
        values: [
          'application_not_found',
          'application_sandbox',
          'application_not_activated',
          'credential_refused',
          'pending_credential_missing',
          'rate_limited',
          'provider_unavailable',
          'unknown',
        ],
        description:
          "Why, as the API's error code without its `enable_banking_` prefix: an ID Enable Banking does not know with this certificate, a Sandbox application, an application not activated by linking an account, another refusal, no pending key (lapsed or replaced), or Enable Banking rate-limited, unreachable or answering something else. Never the provider's message.",
      },
    },
  },
  bank_key_activated: {
    description:
      "The person's pending Enable Banking key passed the signed test call and became their active key. A key pasted in by hand sends nothing.",
    surfaces: ['server'],
    tier: 'service',
    question: 'bank_connections',
    properties: {},
  },
  bank_key_setup_abandoned: {
    description:
      "The daily bank sync sweep deleted the person's pending Enable Banking key, seven days after its certificate was created, never activated.",
    surfaces: ['server'],
    tier: 'service',
    question: 'bank_connections',
    properties: {},
  },

  // Behavioural events: sent by the apps, only with the person's analytics opt-in.
  signup_started: {
    description: 'The signup form was shown.',
    surfaces: ['web'],
    tier: 'behavioural',
    question: 'activation',
    properties: {},
  },
  signup_failed: {
    description:
      'A signup did not go through: the form was refused, or the account was made but the app could not finish signing in. A signup that succeeds is the service event `signup`.',
    surfaces: ['web'],
    tier: 'behavioural',
    question: 'activation',
    properties: {
      reason: {
        type: 'enum',
        values: [
          'recaptcha',
          'auth_provider',
          'missing_user',
          'app_callback',
          'unknown',
        ],
        description:
          'Where it failed: the bot check, the sign-in provider, a response without an account, or finishing sign-in in the app.',
      },
    },
  },
  onboarding_started: {
    description:
      'The person began onboarding, once per browser (the progress is kept in browser storage).',
    surfaces: ['web'],
    tier: 'behavioural',
    question: 'activation',
    properties: {},
  },
  onboarding_step_viewed: {
    description: 'A step of onboarding was shown, once per step and visit.',
    surfaces: ['web'],
    tier: 'behavioural',
    question: 'activation',
    properties: { step: onboardingStep },
  },
  onboarding_step_skipped: {
    description: 'The person skipped a step of onboarding.',
    surfaces: ['web'],
    tier: 'behavioural',
    question: 'activation',
    properties: { step: onboardingStep },
  },
  onboarding_completed: {
    description: 'The person finished onboarding.',
    surfaces: ['web', 'mobile'],
    tier: 'behavioural',
    question: 'activation',
    properties: {},
  },
  bank_connection_started: {
    description:
      'The person began connecting a bank: left for the bank to give consent (Enable Banking), or opened the SimpleFIN setup. How it ends is the service event `bank_connection_completed` or `bank_connection_failed`.',
    surfaces: ['web', 'mobile'],
    tier: 'behavioural',
    question: 'bank_connections',
    properties: {
      provider: {
        type: 'enum',
        values: BANK_PROVIDERS,
        description: 'The bank data provider.',
        optional: true,
      },
    },
  },
  bank_connection_abandoned: {
    description:
      "The person closed the bank's consent page before it returned to the app. The connection may still complete, if the bank had already given consent.",
    surfaces: ['mobile'],
    tier: 'behavioural',
    question: 'bank_connections',
    properties: {
      provider: {
        type: 'enum',
        values: ['enable_banking'],
        description: 'The bank data provider: only Enable Banking sends the person to the bank.',
      },
    },
  },
  bank_key_setup_started: {
    description:
      'The Enable Banking key setup wizard opened, once per opening. The certificate and the activation are the service events `bank_key_certificate_created` and `bank_key_activated`.',
    surfaces: ['web'],
    tier: 'behavioural',
    question: 'bank_connections',
    properties: {
      entry: {
        type: 'enum',
        values: ANALYTICS_BANK_KEY_SETUP_ENTRIES,
        description:
          "Where it was opened from: first-run onboarding's account step, the add account dialog, the home page's no-accounts card, the bank picker, or Settings.",
      },
    },
  },
  bank_key_setup_step_viewed: {
    description:
      'A step of the Enable Banking key setup wizard was shown, once per step and opening. A step behind the "sign in again" notice is not shown.',
    surfaces: ['web'],
    tier: 'behavioural',
    question: 'bank_connections',
    properties: {
      step: {
        type: 'enum',
        values: ANALYTICS_BANK_KEY_SETUP_STEPS,
        description: "The step's stable id.",
      },
    },
  },
  import_started: {
    description:
      'A file was chosen to import.',
    surfaces: ['web', 'mobile'],
    tier: 'behavioural',
    question: 'imports',
    properties: importProperties,
  },
  import_mapped: {
    description:
      "The file was read and its columns matched, so the import is ready for review. A file whose columns the format fixes (OFX, QIF, CAMT.053, YNAB, Actual, a PDF) reaches this step as soon as it is read.",
    surfaces: ['web', 'mobile'],
    tier: 'behavioural',
    question: 'imports',
    properties: importProperties,
  },
  import_reviewed: {
    description:
      'The person confirmed the review and asked to import. The rows written are the service event `import_committed`.',
    surfaces: ['web', 'mobile'],
    tier: 'behavioural',
    question: 'imports',
    properties: importProperties,
  },
  import_failed: {
    description: 'An import stopped on an error the person saw.',
    surfaces: ['web', 'mobile'],
    tier: 'behavioural',
    question: 'imports',
    properties: {
      ...importProperties,
      step: {
        type: 'enum',
        values: ['upload', 'read', 'mapping', 'review', 'commit'],
        description:
          'The step that failed: sending the file, reading it, matching its columns, saving review choices, or importing.',
      },
    },
  },
  feedback_submitted: {
    description:
      'The person sent feedback from the app. The message itself is never sent.',
    surfaces: ['web', 'mobile'],
    tier: 'behavioural',
    question: null,
    properties: {
      category: {
        type: 'enum',
        values: ['bug', 'feature_request', 'other'],
        description: 'The kind of feedback chosen.',
      },
    },
  },
  feature_screen_viewed: {
    description:
      'A screen of the app was shown. Web sends it on each navigation, in place of a pageview.',
    surfaces: ['web', 'mobile'],
    tier: 'behavioural',
    question: 'retention',
    properties: {
      screen: {
        type: 'enum',
        values: featureScreens,
        description: "The screen's identifier, never its path.",
      },
    },
  },
} as const satisfies AnalyticsCatalogue;

export type AnalyticsEvents = typeof ANALYTICS_EVENTS;

/** Any catalogued event name. */
export type AnalyticsEventName = keyof AnalyticsEvents;

/** The events surface `S` may send. */
export type AnalyticsEventNameFor<S extends AnalyticsSurface> =
  CatalogueEventName<AnalyticsEvents, S>;

/** The exact properties of event `E`. */
export type AnalyticsEventProperties<E extends AnalyticsEventName> =
  CatalogueEventProperties<AnalyticsEvents, E>;

/** The argument tuples of surface `S`'s capture function. */
export type AnalyticsCaptureArgs<S extends AnalyticsSurface> =
  CatalogueCaptureArgs<AnalyticsEvents, S>;
