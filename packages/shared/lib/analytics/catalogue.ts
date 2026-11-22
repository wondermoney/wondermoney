import { featureScreens } from './feature-screens';
import type {
  AnalyticsCatalogue,
  AnalyticsSurface,
  CatalogueCaptureArgs,
  CatalogueEventName,
  CatalogueEventProperties,
} from './types';

const AUTH_PROVIDERS = ['email', 'apple', 'google'] as const;

/** The sign-in methods the API knows; `other` covers any provider added later. */
const SIGN_IN_METHODS = ['email', 'google', 'apple', 'oidc', 'other'] as const;

/** `Appuser.language`, as the API stores it. */
const LOCALES = ['EN', 'PT', 'ES'] as const;

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

const BANK_PROVIDERS = ['enable_banking', 'simplefin'] as const;

const PLATFORMS = ['web', 'mobile', 'api'] as const;

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
      'Linking a bank connection failed before any sync ran (a refused consent, a bad token, a provider error).',
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

  // Behavioural events: sent by the apps, only with the person's analytics opt-in.
  sign_up_completed: {
    description: 'A new account finished signing up in the app.',
    surfaces: ['mobile'],
    tier: 'behavioural',
    question: 'activation',
    properties: {
      provider: {
        type: 'enum',
        values: AUTH_PROVIDERS,
        description: 'How the person signed up.',
      },
    },
  },
  sign_in_completed: {
    description: 'An existing account signed in to the app.',
    surfaces: ['mobile'],
    tier: 'behavioural',
    question: 'retention',
    properties: {
      provider: {
        type: 'enum',
        values: AUTH_PROVIDERS,
        description: 'How the person signed in.',
      },
    },
  },
  onboarding_completed: {
    description: 'The person finished onboarding.',
    surfaces: ['mobile'],
    tier: 'behavioural',
    question: 'activation',
    properties: {},
  },
  bank_connection_started: {
    description: 'The person began connecting a bank.',
    surfaces: ['mobile'],
    tier: 'behavioural',
    question: 'bank_connections',
    properties: {},
  },
  feedback_submitted: {
    description:
      'The person sent feedback from the app. The message itself is never sent.',
    surfaces: ['mobile'],
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
    description: 'A screen of the app was shown.',
    surfaces: ['mobile'],
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
