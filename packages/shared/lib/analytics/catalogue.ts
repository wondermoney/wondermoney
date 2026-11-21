import { featureScreens } from './feature-screens';
import type {
  AnalyticsCatalogue,
  AnalyticsSurface,
  CatalogueCaptureArgs,
  CatalogueEventName,
  CatalogueEventProperties,
} from './types';

const AUTH_PROVIDERS = ['email', 'apple', 'google'] as const;

/**
 * Every product analytics event WonderMoney sends, on every surface. An event that is not here
 * cannot be sent: web's `track`, mobile's `captureAnalyticsEvent` and (from #624) the API's
 * outbox are typed by this object. Adding or changing an event is a pull request that edits it;
 * `README.md` next to this file has the rules, and `docs/analytics-events.md` is generated from
 * it (`pnpm --filter @wondermoney/shared analytics-events`).
 */
export const ANALYTICS_EVENTS = {
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
  first_account_created: {
    description: "The person's first account was added from the app.",
    surfaces: ['mobile'],
    tier: 'behavioural',
    question: 'activation',
    properties: {
      method: {
        type: 'enum',
        values: ['manual', 'bank_connection'],
        description: 'Entered by hand or brought in by a bank connection.',
      },
    },
  },
  bank_connection_started: {
    description: 'The person began connecting a bank.',
    surfaces: ['mobile'],
    tier: 'behavioural',
    question: 'bank_connections',
    properties: {},
  },
  bank_connection_completed: {
    description: 'A bank connection finished and its accounts were added.',
    surfaces: ['mobile'],
    tier: 'behavioural',
    question: 'bank_connections',
    properties: {},
  },
  bank_connection_failed: {
    description: 'A bank connection the person started did not finish.',
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
